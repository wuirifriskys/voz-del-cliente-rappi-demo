import { ApifyClient } from "apify-client";
import { requireEnv } from "../lib/env.ts";
import { serverClient } from "../lib/supabase.ts";
import type { RawReview } from "../lib/types.ts";

// NOTE ON APPLE APP STORE:
// Apple's public customer-reviews RSS feed (`itunes.apple.com/mx/rss/customerreviews/...`)
// returns empty for Rappi MX. Every Apify actor we tried (easyapi, benthepythondev,
// jdtpnjtp, andok) either returns zero reviews, needs a paid proxy tier we don't have,
// or requires a bundle ID that errors on Apple's side. This appears to be Apple tightening
// its public review endpoints in certain regions.
//
// The pipeline still compiles and can be re-enabled if a working actor is found, but for
// this demo we rely exclusively on Google Play data (see scrapers/google-play.ts and
// scrapers/google-play-extra.ts). The `scrapeAppStore` function stays exported to keep
// the orchestrator in scrapers/run.ts happy but returns 0 without hitting Apify.
//
// Scrapes Rappi Mexico reviews from the iOS App Store via a public Apify actor.
// Actor: websift/app-store-reviews (configurable via env var).
//
// The actor id and schema can change — if Apify auth fails or the actor is missing,
// Alex can swap in any equivalent actor without code changes beyond the APIFY_APP_STORE_ACTOR env var.

const APP_STORE_ACTOR = process.env.APIFY_APP_STORE_ACTOR ?? "benthepythondev/appstore-reviews-scraper";
const APP_STORE_ID = "975377829"; // Rappi iOS numeric id
const MAX_REVIEWS = Number(process.env.SCRAPE_MAX ?? 500);

export async function scrapeAppStore(): Promise<number> {
  // Opt out: Apple's public review APIs return no data for Rappi MX regardless of actor.
  // Flip APP_STORE_ENABLED to 1 to re-run once a working actor is found.
  if (process.env.APP_STORE_ENABLED !== "1") {
    console.log("[app-store] skipped (Apple public endpoints return empty for Rappi MX)");
    return 0;
  }

  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const supabase = serverClient();

  console.log(`[app-store] running actor ${APP_STORE_ACTOR} for Rappi MX (max ${MAX_REVIEWS})`);

  const run = await apify.actor(APP_STORE_ACTOR).call({
    appIds: [APP_STORE_ID],
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
  // Multiple actors — handle various shapes.
  const reviewId = (raw.reviewId ?? raw.id ?? raw.review_id) as string | undefined;
  const text = (raw.review ?? raw.body ?? raw.text ?? raw.content ?? raw.comment) as string | undefined;
  const title = (raw.title as string) ?? "";
  const rating = Number(raw.rating ?? raw.score ?? raw.stars);
  const dateRaw = (raw.date ?? raw.updated ?? raw.createdAt ?? raw.updatedAt) as string | undefined;
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
