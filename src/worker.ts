// Cloudflare Worker — serves the public Voz del Cliente dashboard and the
// Telegram webhook endpoint. All Supabase reads go through the anon key,
// gated by RLS (only weekly_briefs is readable).

import { createClient } from "@supabase/supabase-js";
import { requireWorkerEnv } from "./lib/env.ts";
import type { WeeklyBrief } from "./lib/types.ts";
import { handleTelegramUpdate } from "./bot/telegram.ts";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return dashboard(env);
    }
    if (url.pathname === "/api/briefs") {
      return briefs(env);
    }
    if (url.pathname.startsWith("/telegram/")) {
      return telegram(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function dashboard(env: Env): Promise<Response> {
  const supabaseUrl = requireWorkerEnv(env, "SUPABASE_URL");
  const anonKey = requireWorkerEnv(env, "SUPABASE_ANON_KEY");

  return new Response(html(supabaseUrl, anonKey), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

async function briefs(env: Env): Promise<Response> {
  const supabase = createClient(requireWorkerEnv(env, "SUPABASE_URL"), requireWorkerEnv(env, "SUPABASE_ANON_KEY"));
  const { data, error } = await supabase
    .from("weekly_briefs")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(20);

  if (error) return json({ error: error.message }, 500);
  return json({ briefs: data ?? [] });
}

async function telegram(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = url.pathname.split("/").pop();
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const update = (await request.json()) as Parameters<typeof handleTelegramUpdate>[0];
    await handleTelegramUpdate(update, env);
    return new Response("ok");
  } catch (err) {
    console.error("[telegram] error:", err);
    return new Response("ok"); // always 200 so Telegram doesn't retry-storm
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Minimal single-page dashboard. Fetches /api/briefs client-side.
function html(_supabaseUrl: string, _anonKey: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voz del Cliente — Rappi MX (demo)</title>
<style>
  :root{--bg:#0b0b0f;--card:#15151c;--border:#2a2a35;--text:#f2f2f5;--muted:#9a9aa8;--accent:#ff6f3c;--accent2:#ff2d87}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
  header{padding:32px 24px 16px;border-bottom:1px solid var(--border);max-width:1100px;margin:0 auto}
  header h1{font-size:22px;font-weight:700;letter-spacing:-.2px}
  header h1 span{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  header p{color:var(--muted);font-size:13px;margin-top:6px}
  main{max-width:1100px;margin:0 auto;padding:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
  .card h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin-bottom:12px}
  .stat{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--muted);padding:6px 0;border-bottom:1px solid var(--border)}
  .stat:last-child{border-bottom:none}
  .stat b{color:var(--text);font-weight:600}
  .pain{font-size:13px;margin:8px 0;padding-left:12px;border-left:2px solid var(--accent2)}
  .cluster{background:#1c1c24;border-radius:8px;padding:12px;margin-bottom:10px;font-size:13px}
  .cluster .theme{font-weight:600;margin-bottom:4px}
  .cluster .quote{color:var(--muted);font-style:italic;font-size:12px;margin-top:6px}
  .cluster .count{display:inline-block;background:var(--accent);color:#000;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px}
  footer{max-width:1100px;margin:24px auto;padding:16px 24px;color:var(--muted);font-size:12px;border-top:1px solid var(--border)}
  .loading{text-align:center;color:var(--muted);padding:48px;font-size:14px}
  .error{color:#ff6b6b;padding:16px;background:#2a1515;border-radius:8px;font-size:13px}
</style>
</head>
<body>
<header>
  <h1><span>Voz del Cliente</span> · Rappi México</h1>
  <p>Agente que clasifica reseñas públicas de App Store y Google Play por vertical y causa raíz. Demo independiente, datos públicos. Actualizado semanalmente.</p>
</header>
<main id="grid"><div class="loading">Cargando briefs…</div></main>
<footer>
  Demo independiente construida para la vacante Rappi AI Builder. No afiliado a Rappi.
  Basado en reseñas públicas de App Store y Google Play.
  · <a href="https://github.com/" style="color:var(--muted)">Ver código</a>
</footer>
<script>
  (async () => {
    const grid = document.getElementById('grid');
    try {
      const res = await fetch('/api/briefs');
      const { briefs = [], error } = await res.json();
      if (error) throw new Error(error);
      if (briefs.length === 0) {
        grid.innerHTML = '<div class="loading">Sin datos aún. El pipeline corre semanalmente.</div>';
        return;
      }
      const latestWeek = briefs[0].week_start;
      const thisWeek = briefs.filter(b => b.week_start === latestWeek);
      grid.innerHTML = thisWeek.map(renderCard).join('');
    } catch (err) {
      grid.innerHTML = '<div class="error">Error cargando briefs: ' + err.message + '</div>';
    }
  })();

  function renderCard(b) {
    const painHTML = (b.top_pain_points || []).map(p =>
      '<div class="pain">' + escapeHtml(p.pain_point) + ' · <b>' + p.count + '</b> (' + Math.round(p.share * 100) + '%)</div>'
    ).join('');
    const clusterHTML = (b.clusters || []).map(c =>
      '<div class="cluster"><div class="theme">' + escapeHtml(c.theme) + '<span class="count">' + c.count + '</span></div>' +
      (c.example_quote ? '<div class="quote">"' + escapeHtml(c.example_quote) + '"</div>' : '') +
      '</div>'
    ).join('');
    return '<section class="card">' +
      '<h2>' + escapeHtml(b.vertical) + '</h2>' +
      '<div class="stat"><span>Reseñas (7d)</span><b>' + b.total_reviews + '</b></div>' +
      '<div class="stat"><span>Share negativas</span><b>' + Math.round(b.negative_share * 100) + '%</b></div>' +
      '<div style="margin-top:12px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px">Top pain points</div>' +
      painHTML +
      '<div style="margin-top:12px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px">Clusters</div>' +
      clusterHTML +
    '</section>';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
</script>
</body>
</html>`;
}
