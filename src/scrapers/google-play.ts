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

const GOOGLE_PLAY_ACTOR = process.env.APIFY_GOOGLE_PLAY_ACTOR ?? "lhotanok/google-play-reviews-scraper";
const APP_ID = "com.grability.rappi"; // Rappi Android package id
const MAX_REVIEWS = Number(process.env.SCRAPE_MAX ?? 2500);

export async function scrapeGooglePlay(): Promise<number> {
  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const supabase = serverClient();

  console.log(`[google-play] running actor ${GOOGLE_PLAY_ACTOR} for ${APP_ID} (max ${MAX_REVIEWS})`);

  const run = await apify.actor(GOOGLE_PLAY_ACTOR).call({
    appIds: [APP_ID],
    country: "mx",
    language: "es",
    maxReviews: MAX_REVIEWS,
    sort: "newest",
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
  const reviewId = (raw.reviewId ?? raw.id) as string | undefined;
  const text = (raw.text ?? raw.content) as string | undefined;
  const rating = Number(raw.score ?? raw.rating);
  const dateRaw = (raw.at ?? raw.date) as string | undefined;
  if (!reviewId || !text || !Number.isFinite(rating) || !dateRaw) return null;

  return {
    id: `gp:${reviewId}`,
    source: "google_play",
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    review_date: new Date(dateRaw).toISOString(),
    text,
    language: (raw.language as string) ?? "es",
    country: "MX",
    raw_author_id: (raw.userName as string) ?? null,
  };
}
