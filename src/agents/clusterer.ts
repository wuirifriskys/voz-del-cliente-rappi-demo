// Weekly clustering agent. Groups the last 7 days of classified reviews into
// root-cause clusters per vertical and writes weekly_briefs.
//
// Run: `bun src/agents/clusterer.ts`

import { anthropic, CLUSTERER_MODEL } from "../lib/anthropic.ts";
import { serverClient } from "../lib/supabase.ts";
import type { PainPoint, Vertical, WeeklyBrief } from "../lib/types.ts";

const VERTICALS: Vertical[] = ["food", "grocery", "pharmacy", "rappipay", "courier", "app", "other"];
const LOOKBACK_DAYS = Number(process.env.CLUSTER_LOOKBACK_DAYS ?? 7);
const MAX_REVIEWS_PER_VERTICAL = 500;

interface JoinedRow {
  review_id: string;
  vertical: Vertical;
  pain_point: PainPoint;
  sentiment: number;
  summary_es: string;
  text: string;
  review_date: string;
}

export async function runClusterer(): Promise<{ briefs: number }> {
  const supabase = serverClient();
  const claude = anthropic();

  const weekStart = startOfIsoWeek(new Date());
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  let briefsWritten = 0;

  for (const vertical of VERTICALS) {
    const { data, error } = await supabase
      .from("classified_reviews")
      .select("review_id, vertical, pain_point, sentiment, summary_es, raw_reviews!inner(text, review_date)")
      .eq("vertical", vertical)
      .gte("raw_reviews.review_date", since)
      .limit(MAX_REVIEWS_PER_VERTICAL);

    if (error) {
      console.error(`[clusterer] fetch ${vertical} failed:`, error.message);
      continue;
    }

    const rows = (data ?? []).map(flattenRow).filter((r): r is JoinedRow => r !== null);
    if (rows.length < 3) {
      console.log(`[clusterer] ${vertical}: ${rows.length} reviews, skipping`);
      continue;
    }

    // Top pain points are actionable complaint categories. We exclude pain_point="other"
    // because it mostly captures positive reviews (no pain) and vague negatives. Share
    // is computed against the number of reviews WITH a specific pain — so shares stay
    // meaningful (they represent % of actionable complaints, not % of all reviews).
    const withSpecificPain = rows.filter((r) => r.pain_point !== "other");
    const painCounts = countBy(withSpecificPain.map((r) => r.pain_point));
    const topPainPoints = Object.entries(painCounts)
      .map(([pain_point, count]) => ({
        pain_point: pain_point as PainPoint,
        count,
        share: withSpecificPain.length > 0 ? count / withSpecificPain.length : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Clusters only look at reviews with a specific pain point (not positives, not "other")
    const rawClusters = await clusterWithClaude(claude, vertical, withSpecificPain);
    // Quote-verification guardrail: drop any cluster whose example_quote isn't
    // present (verbatim or normalized) in the source reviews. The system prompt
    // says "NUNCA inventes citas" — this enforces it.
    const clusters = verifyClusterQuotes(rawClusters, withSpecificPain);
    const droppedQuotes = rawClusters.length - clusters.length;
    if (droppedQuotes > 0) {
      console.warn(`[clusterer] ${vertical}: dropped ${droppedQuotes} cluster(s) with unverifiable quotes`);
    }
    const negativeShare = rows.filter((r) => r.sentiment <= 2).length / rows.length;

    const brief: WeeklyBrief = {
      id: `${isoWeekLabel(weekStart)}-${vertical}`,
      week_start: weekStart.toISOString().slice(0, 10),
      vertical,
      total_reviews: rows.length,
      negative_share: round(negativeShare, 4),
      top_pain_points: topPainPoints,
      clusters,
      generated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase.from("weekly_briefs").upsert(brief, { onConflict: "id" });
    if (upsertErr) {
      console.error(`[clusterer] upsert ${vertical} failed:`, upsertErr.message);
      continue;
    }

    briefsWritten++;
    console.log(`[clusterer] ${vertical}: ${rows.length} reviews, ${clusters.length} clusters`);
  }

  return { briefs: briefsWritten };
}

async function clusterWithClaude(
  claude: ReturnType<typeof anthropic>,
  vertical: Vertical,
  rows: JoinedRow[],
): Promise<Array<{ theme: string; count: number; example_quote: string }>> {
  const sample = rows.slice(0, 150);
  const system = `Agrupas reseñas negativas de Rappi México por causa raíz. Devuelve 3-5 clusters ordenados por frecuencia.
Para cada cluster:
- theme: descripción concisa en español (máx 80 caracteres)
- count: número aproximado de reseñas en el cluster
- example_quote: UNA cita real textual de las reseñas (anónima, sin nombres, máx 140 caracteres)

Reglas:
- Los clusters deben ser accionables ("Faltan medicamentos en Polanco" > "Problemas de inventario")
- Menciona zona geográfica SOLO si está en las reseñas
- NUNCA inventes citas`;

  const user = `Vertical: ${vertical}
Total reseñas (últimos 7 días): ${rows.length}

Reseñas (id | sentiment | resumen | texto):
${sample
  .map((r) => `${r.review_id} | s=${r.sentiment} | ${r.summary_es} | ${truncate(r.text, 400)}`)
  .join("\n")}

Devuelve SOLO un array JSON válido:
[{"theme": "...", "count": N, "example_quote": "..."}]`;

  const response = await claude.messages.create({
    model: CLUSTERER_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];
  const match = textBlock.text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

function verifyClusterQuotes(
  clusters: Array<{ theme: string; count: number; example_quote: string }>,
  rows: JoinedRow[],
): Array<{ theme: string; count: number; example_quote: string }> {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[…""'".,;:!?¡¿()"'—–-]/g, "").trim();
  const corpusNorm = rows.map((r) => normalize(r.text)).join("\n\n");
  // Accept a cluster quote if:
  // (a) full normalized quote is a substring of the corpus, OR
  // (b) a contiguous 40-char window from the quote is a substring of the corpus
  //     (handles minor paraphrasing — Claude often changes one or two words).
  return clusters
    .map((c) => {
      const q = c.example_quote ?? "";
      if (!q) return { c, replacement: null };
      const qNorm = normalize(q);
      if (qNorm.length < 20) return { c, replacement: null };
      if (corpusNorm.includes(qNorm)) return { c, replacement: null };
      // Try to find any 40-char window that matches — if found, replace the
      // quote with a real one from the corpus that covers the same theme.
      for (let i = 0; i <= qNorm.length - 40; i += 10) {
        const window = qNorm.slice(i, i + 40);
        if (corpusNorm.includes(window)) {
          // Find the actual row whose text contains this window and use it as the quote
          for (const r of rows) {
            if (normalize(r.text).includes(window)) {
              const realQuote = r.text.length > 140 ? r.text.slice(0, 140).trimEnd() : r.text;
              return { c: { ...c, example_quote: realQuote }, replacement: "window" as const };
            }
          }
        }
      }
      return { c, replacement: "drop" as const };
    })
    .filter((x) => x.replacement !== "drop")
    .map((x) => x.c);
}

function flattenRow(row: Record<string, unknown>): JoinedRow | null {
  const joined = (row.raw_reviews ?? {}) as Record<string, unknown>;
  const text = joined.text as string | undefined;
  const reviewDate = joined.review_date as string | undefined;
  if (!text || !reviewDate) return null;
  return {
    review_id: row.review_id as string,
    vertical: row.vertical as Vertical,
    pain_point: row.pain_point as PainPoint,
    sentiment: row.sentiment as number,
    summary_es: row.summary_es as string,
    text,
    review_date: reviewDate,
  };
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function startOfIsoWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function isoWeekLabel(d: Date): string {
  const target = new Date(d);
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

if (import.meta.main) {
  runClusterer()
    .then((r) => console.log("[clusterer] done:", r))
    .catch((err) => {
      console.error("[clusterer] fatal:", err);
      process.exit(1);
    });
}
