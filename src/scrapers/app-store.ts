import { ApifyClient } from "apify-client";
import { requireEnv } from "../lib/env.ts";
import { serverClient } from "../lib/supabase.ts";
import type { RawReview } from "../lib/types.ts";

// Scrapes Rappi Mexico reviews from the iOS App Store via a public Apify actor.
// Actor: websift/app-store-reviews (configurable via env var).
//
// The actor id and schema can change — if Apify auth fails or the actor is missing,
// Alex can swap in any equivalent actor without code changes beyond the APIFY_APP_STORE_ACTOR env var.

const APP_STORE_ACTOR = process.env.APIFY_APP_STORE_ACTOR ?? "benthepythondev/appstore-reviews-scraper";
const APP_STORE_URL = "https://apps.apple.com/mx/app/rappi/id975377829";
const MAX_REVIEWS = Number(process.env.SCRAPE_MAX ?? 2500);

export async function scrapeAppStore(): Promise<number> {
  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const supabase = serverClient();

  console.log(`[app-store] running actor ${APP_STORE_ACTOR} for Rappi MX (max ${MAX_REVIEWS})`);

  const run = await apify.actor(APP_STORE_ACTOR).call({
    appUrls: [APP_STORE_URL],
    countries: ["mx"],
    maxReviews: MAX_REVIEWS,
    sortBy: "mostRecent",
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  console.log(`[app-store] fetched ${items.length} reviews`);

  const rows: RawReview[] = items
    .map((raw: Record<string, unknown>) => toRawReview(raw))
    .filter((r): r is RawReview => r !== null);

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("raw_reviews").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`[app-store] upsert failed: ${error.message}`);
  }

  console.log(`[app-store] persisted ${rows.length} rows`);
  return rows.length;
}

function toRawReview(raw: Record<string, unknown>): RawReview | null {
  // jdtpnjtp's schema: { reviewId, userName, title, review, rating, date, ... }
  // Some actors wrap reviews under a `reviews` array or return flat items — handle both.
  const reviewId = (raw.reviewId ?? raw.id) as string | undefined;
  const text = (raw.review ?? raw.body ?? raw.text) as string | undefined;
  const title = (raw.title as string) ?? "";
  const rating = Number(raw.rating ?? raw.score);
  const dateRaw = (raw.date ?? raw.updated ?? raw.createdAt) as string | undefined;
  if (!reviewId || !text || !Number.isFinite(rating) || !dateRaw) return null;

  return {
    id: `as:${reviewId}`,
    source: "app_store",
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    review_date: new Date(dateRaw).toISOString(),
    text: title ? `${title}\n\n${text}` : text,
    language: (raw.language as string) ?? "es",
    country: "MX",
    raw_author_id: (raw.userName as string) ?? null,
  };
}
