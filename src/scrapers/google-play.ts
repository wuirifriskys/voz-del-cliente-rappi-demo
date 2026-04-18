import { ApifyClient } from "apify-client";
import { requireEnv } from "../lib/env.ts";
import { serverClient } from "../lib/supabase.ts";
import type { RawReview } from "../lib/types.ts";

// Scrapes Rappi Mexico reviews from Google Play using a public Apify actor.
// Actor: lhotanok/google-play-reviews-scraper (configurable via env var).
//
// Env:
//   APIFY_TOKEN — Apify API token
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — to persist raw reviews

const GOOGLE_PLAY_ACTOR = process.env.APIFY_GOOGLE_PLAY_ACTOR ?? "neatrat/google-play-store-reviews-scraper";
// Use the full Play Store URL with MX locale so the actor returns MX reviews.
const APP_URL = "https://play.google.com/store/apps/details?id=com.grability.rappi&gl=mx&hl=es";
const MAX_REVIEWS = Number(process.env.SCRAPE_MAX ?? 2500);

export async function scrapeGooglePlay(): Promise<number> {
  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const supabase = serverClient();

  console.log(`[google-play] running actor ${GOOGLE_PLAY_ACTOR} for Rappi MX (max ${MAX_REVIEWS})`);

  const run = await apify.actor(GOOGLE_PLAY_ACTOR).call({
    appIdOrUrl: APP_URL,
    sortBy: "newest",
    maxReviews: MAX_REVIEWS,
    reviewsPerPage: 100,
    pagesToScrape: Math.ceil(MAX_REVIEWS / 100),
    uniqueOnly: false,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  console.log(`[google-play] fetched ${items.length} reviews`);

  const rows: RawReview[] = items
    .map((raw: Record<string, unknown>) => toRawReview(raw))
    .filter((r): r is RawReview => r !== null);

  // Upsert in chunks to avoid payload limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("raw_reviews").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`[google-play] upsert failed: ${error.message}`);
  }

  console.log(`[google-play] persisted ${rows.length} rows`);
  return rows.length;
}

function toRawReview(raw: Record<string, unknown>): RawReview | null {
  // neatrat schema: reviewId, rating, reviewer, date, body, language, timestamp, ...
  const reviewId = (raw.reviewId ?? raw.id) as string | undefined;
  const text = (raw.body ?? raw.text ?? raw.content) as string | undefined;
  const rating = Number(raw.rating ?? raw.score);
  const dateRaw = (raw.date ?? raw.at) as string | undefined;
  if (!reviewId || !text || !Number.isFinite(rating) || !dateRaw) return null;

  return {
    id: `gp:${reviewId}`,
    source: "google_play",
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    review_date: new Date(dateRaw).toISOString(),
    text,
    language: (raw.language as string) ?? (raw.reviewedIn as string) ?? "es",
    country: "MX",
    raw_author_id: (raw.reviewer as string) ?? (raw.userName as string) ?? null,
  };
}
