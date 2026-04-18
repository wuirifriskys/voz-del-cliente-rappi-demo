// Orchestrates both scrapers. Run: `bun src/scrapers/run.ts`

import { scrapeGooglePlay } from "./google-play.ts";
import { scrapeAppStore } from "./app-store.ts";

async function main() {
  const started = Date.now();
  const [gp, as] = await Promise.allSettled([scrapeGooglePlay(), scrapeAppStore()]);

  const report = {
    google_play: gp.status === "fulfilled" ? { ok: true, count: gp.value } : { ok: false, error: String(gp.reason) },
    app_store: as.status === "fulfilled" ? { ok: true, count: as.value } : { ok: false, error: String(as.reason) },
    elapsed_s: ((Date.now() - started) / 1000).toFixed(1),
  };
  console.log("[scrape] done:", JSON.stringify(report, null, 2));
  if (!report.google_play.ok && !report.app_store.ok) process.exit(1);
}

main().catch((err) => {
  console.error("[scrape] fatal:", err);
  process.exit(1);
});
