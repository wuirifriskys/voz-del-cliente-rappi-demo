import { ApifyClient } from "apify-client";
import { requireEnv } from "../lib/env.ts";
import { serverClient } from "../lib/supabase.ts";
import type { RawReview } from "../lib/types.ts";

// Second Google Play scraper using webdatalabs/google-play-reviews-scraper.
// This runs against a separate Apify actor from the primary one in google-play.ts
// so we get a separate free-tier quota (~500 reviews per actor per month) and pull
// extra volume without upgrading the Apify plan.

const EXTRA_ACTOR = process.env.APIFY_GOOGLE_PLAY_EXTRA_ACTOR ?? "webdatalabs/google-play-reviews-scraper";
const APP_URL = "https://play.google.com/store/apps/details?id=com.grability.rappi&gl=mx&hl=es";
const MAX_REVIEWS = Number(process.env.SCRAPE_EXTRA_MAX ?? 1500);

export async function scrapeGooglePlayExtra(): Promise<number> {
  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const supabase = serverClient();

  console.log(`[google-play-extra] running ${EXTRA_ACTOR} for Rappi MX (max ${MAX_REVIEWS})`);

  const run = await apify.actor(EXTRA_ACTOR).call({
    startUrls: [{ url: APP_URL }],
    maxReviews: MAX_REVIEWS,
    sortBy: "NEWEST",
    rating: "ALL",
    language: "es",
  });

  // Apify's default listItems limit is low — ask for everything explicitly.
  const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 10_000 });
  console.log(`[google-play-extra] fetched ${items.length} items`);

  const rows: RawReview[] = items
    .map((raw: Record<string, unknown>) => toRawReview(raw))
    .filter((r): r is RawReview => r !== null);

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("raw_reviews").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`[google-play-extra] upsert failed: ${error.message}`);
  }

  console.log(`[google-play-extra] persisted ${rows.length} rows`);
  return rows.length;
}

function toRawReview(raw: Record<string, unknown>): RawReview | null {
  // webdatalabs shape: { reviewId, appId, rating, text, userName, reviewDate, scrapedAt }
  const reviewId = (raw.reviewId ?? raw.id ?? raw.review_id) as string | undefined;
  const text = (raw.text ?? raw.content ?? raw.body ?? raw.review) as string | undefined;
  const rating = Number(raw.rating ?? raw.score ?? raw.stars);
  const dateRaw = (raw.reviewDate ?? raw.at ?? raw.date ?? raw.createdAt ?? raw.timestamp) as
    | string
    | number
    | undefined;
  if (!reviewId || !text || !Number.isFinite(rating) || !dateRaw) return null;

  return {
    id: `gpx:${reviewId}`,
    source: "google_play",
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    review_date: new Date(dateRaw as string | number).toISOString(),
    text,
    language: (raw.language as string) ?? "es",
    country: "MX",
    raw_author_id: (raw.userName as string) ?? (raw.reviewer as string) ?? null,
  };
}
