// One-time cleanup: remove duplicate classifications of the same review.
// Parallel scrapers produce 2+ raw_reviews rows for the same underlying review
// (different id prefixes: gp:, gpe:, gpx:). When both get classified, the stats
// double-count and can disagree on vertical/pain.
//
// This script:
//   1. Groups classified_reviews by UUID suffix (the part after "prefix:")
//   2. For each UUID with >1 classification, keeps the one whose id-prefix
//      ranks first (gp > gpe > gpx)
//   3. Deletes the rest from classified_reviews
//
// Dry-run by default. Pass --apply to actually delete.
//
// Run: `bun scripts/dedup-classified.ts [--apply]`

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key);
const apply = process.argv.includes("--apply");

const PREFIX_RANK: Record<string, number> = { gp: 0, gpe: 1, gpx: 2 };
const rankOf = (id: string) => PREFIX_RANK[id.split(":")[0]] ?? 9;
const uuidOf = (id: string) => id.split(":")[1] ?? id;

async function main() {
  // Fetch all classified reviews
  const all: Array<{ review_id: string; vertical: string; pain_point: string; sentiment: number }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("classified_reviews")
      .select("review_id, vertical, pain_point, sentiment")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`[dedup] fetched ${all.length} classifications`);

  // Group by UUID
  const byUuid = new Map<string, typeof all>();
  for (const c of all) {
    const uuid = uuidOf(c.review_id);
    const bucket = byUuid.get(uuid) ?? [];
    bucket.push(c);
    byUuid.set(uuid, bucket);
  }

  // Find duplicate groups, pick keeper (lowest rank), queue the rest for delete
  const toDelete: string[] = [];
  let dupGroups = 0;
  let vertDisagreements = 0;
  let painDisagreements = 0;
  const sampleDisagreements: Array<{ uuid: string; rows: typeof all }> = [];
  for (const [uuid, rows] of byUuid) {
    if (rows.length < 2) continue;
    dupGroups++;
    if (new Set(rows.map((r) => r.vertical)).size > 1) vertDisagreements++;
    if (new Set(rows.map((r) => r.pain_point)).size > 1) painDisagreements++;
    if (sampleDisagreements.length < 5 && new Set(rows.map((r) => r.vertical)).size > 1) {
      sampleDisagreements.push({ uuid, rows });
    }
    // Sort by prefix rank, keep the first
    const sorted = rows.slice().sort((a, b) => rankOf(a.review_id) - rankOf(b.review_id));
    for (const r of sorted.slice(1)) toDelete.push(r.review_id);
  }

  console.log(`[dedup] ${dupGroups} UUIDs with multiple classifications`);
  console.log(`[dedup] ${vertDisagreements} disagreed on vertical, ${painDisagreements} disagreed on pain`);
  console.log(`[dedup] ${toDelete.length} rows queued for deletion`);
  console.log(`[dedup] sample vertical disagreements:`);
  for (const s of sampleDisagreements) {
    console.log(`  uuid ${s.uuid}:`, s.rows.map((r) => `${r.review_id} → ${r.vertical}/${r.pain_point}/s${r.sentiment}`));
  }

  if (!apply) {
    console.log(`[dedup] DRY-RUN — pass --apply to actually delete`);
    return;
  }

  // Delete in chunks of 100
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const chunk = toDelete.slice(i, i + 100);
    const { error } = await sb.from("classified_reviews").delete().in("review_id", chunk);
    if (error) {
      console.error(`[dedup] delete chunk ${i / 100} failed:`, error.message);
      continue;
    }
    deleted += chunk.length;
  }
  console.log(`[dedup] deleted ${deleted} rows`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
