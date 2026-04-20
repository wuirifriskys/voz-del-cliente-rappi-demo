// Final-state audit after re-classification + re-clustering. Read-only.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function main() {
  const raws = await fetchAll<{ id: string; text: string; rating: number; review_date: string }>(
    "raw_reviews",
    "id,text,rating,review_date",
  );
  const cls = await fetchAll<{ review_id: string; vertical: string; pain_point: string; sentiment: number }>(
    "classified_reviews",
    "review_id,vertical,pain_point,sentiment",
  );
  const briefs = await fetchAll<{
    id: string;
    vertical: string;
    total_reviews: number;
    negative_share: number;
    clusters: Array<{ theme: string; count: number; example_quote: string }>;
    top_pain_points: Array<{ pain_point: string; count: number; share: number }>;
  }>("weekly_briefs", "id,vertical,total_reviews,negative_share,clusters,top_pain_points");

  const uuidOf = (id: string) => id.split(":")[1] ?? id;

  console.log("=== counts ===");
  console.log({ raw: raws.length, classified: cls.length, briefs: briefs.length });

  // Coverage by UUID (not by row count)
  const rawUuids = new Set(raws.map((r) => uuidOf(r.id)));
  const clsUuids = new Set(cls.map((c) => uuidOf(c.review_id)));
  const unclassifiedUuids = [...rawUuids].filter((u) => !clsUuids.has(u));
  console.log("=== uuid coverage ===");
  console.log({
    unique_raw_uuids: rawUuids.size,
    unique_classified_uuids: clsUuids.size,
    unclassified_uuids: unclassifiedUuids.length,
    coverage_pct: Math.round((clsUuids.size / rawUuids.size) * 100),
  });

  // Duplicate classifications check
  const dupClsUuids = cls.reduce<Record<string, number>>((a, c) => {
    const u = uuidOf(c.review_id);
    a[u] = (a[u] ?? 0) + 1;
    return a;
  }, {});
  const nowDupes = Object.entries(dupClsUuids).filter(([, n]) => n > 1).length;
  console.log("=== duplicate classifications ===");
  console.log({ uuids_with_multiple_classifications: nowDupes });

  // Vertical distribution
  const byVertical: Record<string, number> = {};
  for (const c of cls) byVertical[c.vertical] = (byVertical[c.vertical] ?? 0) + 1;
  console.log("=== vertical distribution ===");
  console.log(byVertical);

  // Sentiment distribution
  const bySent: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of cls) bySent[c.sentiment]++;
  console.log("=== sentiment distribution ===");
  console.log(bySent);

  // Pain distribution
  const byPain: Record<string, number> = {};
  for (const c of cls) byPain[c.pain_point] = (byPain[c.pain_point] ?? 0) + 1;
  console.log("=== pain distribution ===");
  console.log(byPain);

  // Briefs summary
  console.log("=== briefs ===");
  for (const b of briefs.sort((a, b) => b.total_reviews - a.total_reviews)) {
    console.log(`${b.vertical}: ${b.total_reviews} reviews, ${Math.round(b.negative_share * 100)}% neg, ${b.clusters.length} clusters`);
  }

  // Quote verification — every cluster quote must appear in raw_reviews (normalized)
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[…""'".,;:!?¡¿()"'—–-]/g, "").trim();
  const corpusNorm = raws.map((r) => normalize(r.text)).join("\n\n");
  const allQuotes: Array<{ brief: string; theme: string; quote: string; found: boolean }> = [];
  for (const b of briefs) {
    for (const c of b.clusters ?? []) {
      const q = c.example_quote ?? "";
      const qNorm = normalize(q);
      allQuotes.push({
        brief: b.id,
        theme: c.theme,
        quote: q.slice(0, 100),
        found: qNorm.length >= 20 && corpusNorm.includes(qNorm),
      });
    }
  }
  const notFound = allQuotes.filter((q) => !q.found);
  console.log("=== cluster quote verification ===");
  console.log({
    total_quotes: allQuotes.length,
    found_verbatim_normalized: allQuotes.length - notFound.length,
    not_found: notFound.length,
  });
  if (notFound.length > 0) {
    console.log("not_found details:");
    for (const q of notFound) console.log(` - [${q.brief}] ${q.theme}: "${q.quote}"`);
  }

  // Language/rating coverage sanity
  const unclassifiedRawIds = raws.filter((r) => !clsUuids.has(uuidOf(r.id)));
  console.log("=== unclassified sample (should be small/residual) ===");
  console.log({ count: unclassifiedRawIds.length, sample: unclassifiedRawIds.slice(0, 5).map((r) => ({ id: r.id, text: r.text.slice(0, 80) })) });
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
