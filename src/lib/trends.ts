// Per-week per-vertical trend computation, shared by the Worker's /api/trends
// endpoint and the Telegram bot's /trend command. Uses service role to read
// classified_reviews + raw_reviews (both RLS-gated from the anon role).

import { createClient } from "@supabase/supabase-js";

export interface TrendWeek {
  week: string;
  total_reviews: number;
  negative_share: number;
  top_pain_points: Array<{ pain_point: string; count: number; share: number }>;
}

export interface VerticalTrend {
  vertical: string;
  weeks: TrendWeek[];
}

export async function computeTrends(
  supabaseUrl: string,
  serviceRoleKey: string,
  windowWeeks = 6,
): Promise<VerticalTrend[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  type Row = { review_id: string; vertical: string; pain_point: string; sentiment: number };
  const cls: Row[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase
      .from("classified_reviews")
      .select("review_id,vertical,pain_point,sentiment")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    cls.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const raws: Array<{ id: string; review_date: string }> = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase
      .from("raw_reviews")
      .select("id,review_date")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    raws.push(...(data as Array<{ id: string; review_date: string }>));
    if (data.length < 1000) break;
  }

  const dateById = new Map(raws.map((r) => [r.id, r.review_date]));

  type Bucket = { total: number; neg: number; pains: Record<string, number> };
  const byVW: Record<string, Record<string, Bucket>> = {};
  for (const c of cls) {
    const d = dateById.get(c.review_id);
    if (!d) continue;
    const w = isoWeekLabel(new Date(d));
    byVW[c.vertical] = byVW[c.vertical] ?? {};
    byVW[c.vertical][w] = byVW[c.vertical][w] ?? { total: 0, neg: 0, pains: {} };
    const b = byVW[c.vertical][w];
    b.total++;
    if (c.sentiment <= 2) b.neg++;
    if (c.pain_point !== "other") b.pains[c.pain_point] = (b.pains[c.pain_point] ?? 0) + 1;
  }

  return Object.keys(byVW)
    .sort()
    .map((vertical) => {
      const weeks = Object.keys(byVW[vertical]).sort().slice(-windowWeeks);
      const series: TrendWeek[] = weeks.map((w) => {
        const b = byVW[vertical][w];
        const painSpecific = Object.values(b.pains).reduce((a, c) => a + c, 0);
        const topPains = Object.entries(b.pains)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([pain_point, count]) => ({
            pain_point,
            count,
            share: painSpecific > 0 ? count / painSpecific : 0,
          }));
        return {
          week: w,
          total_reviews: b.total,
          negative_share: b.total > 0 ? b.neg / b.total : 0,
          top_pain_points: topPains,
        };
      });
      return { vertical, weeks: series };
    });
}

// ISO-week label like "2026-W16" for a given date.
export function isoWeekLabel(d: Date): string {
  const target = new Date(d);
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
