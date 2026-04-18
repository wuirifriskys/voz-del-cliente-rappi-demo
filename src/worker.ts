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

// Single-page dashboard rendered client-side from /api/briefs.
function html(_supabaseUrl: string, _anonKey: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voz del Cliente — Rappi MX | Análisis de reseñas con IA</title>
<meta name="description" content="Agente de IA que analiza reseñas públicas de Rappi México por vertical y causa raíz. Demo independiente para la vacante AI Builder.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0f;
    --bg-2: #11111a;
    --card: #15151f;
    --card-hover: #1a1a25;
    --border: #252532;
    --border-hover: #35354a;
    --text: #f5f5f7;
    --muted: #9a9aae;
    --muted-2: #6b6b80;
    --accent: #ff6f3c;
    --accent-2: #ff2d87;
    --accent-soft: rgba(255, 111, 60, 0.12);
    --danger: #ff4c64;
    --warning: #ffb84d;
    --success: #34d399;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 90px; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6; font-size: 15px;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
  a { color: inherit; }
  .grad {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }

  /* TICKER (T1.3) — live-feel strip above nav */
  .ticker {
    background: #0f0f18; border-bottom: 1px solid var(--border);
    color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 12px;
    padding: 8px 0; overflow: hidden; white-space: nowrap;
  }
  .ticker-inner { display: flex; align-items: center; gap: 24px; padding-left: 24px; }
  .ticker-pulse {
    width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
    flex-shrink: 0; animation: pulse 1.4s infinite;
  }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 var(--accent); }
    50% { box-shadow: 0 0 0 6px rgba(255, 111, 60, 0); }
  }
  .ticker-text {
    display: inline-block; transition: opacity .35s;
  }
  .ticker-text strong { color: var(--text); font-weight: 500; }
  .ticker-text .tag { color: var(--accent); font-weight: 600; margin-right: 8px; }

  /* NAV */
  nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(10, 10, 15, 0.85); backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
  }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; }
  .logo { font-weight: 700; font-size: 15px; letter-spacing: -0.2px; }
  .nav-links { display: flex; gap: 24px; align-items: center; font-size: 14px; }
  .nav-links a { color: var(--muted); text-decoration: none; transition: color .15s; }
  .nav-links a:hover { color: var(--text); }
  .nav-cta {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff !important; padding: 8px 16px; border-radius: 999px;
    font-weight: 600; font-size: 13px; transition: transform .15s;
  }
  .nav-cta:hover { transform: translateY(-1px); }
  @media (max-width: 820px) { .nav-links a:not(.nav-cta) { display: none; } }

  /* HERO */
  .hero { padding: 72px 0 56px; }
  .hero-tag {
    display: inline-block; padding: 4px 12px;
    background: var(--accent-soft); color: var(--accent);
    border: 1px solid rgba(255, 111, 60, 0.3); border-radius: 999px;
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 20px;
  }
  .hero h1 {
    font-size: clamp(34px, 6vw, 56px); font-weight: 800;
    line-height: 1.05; letter-spacing: -1.5px; margin-bottom: 20px;
  }
  .hero-sub { font-size: 18px; color: var(--muted); max-width: 680px; margin-bottom: 40px; }
  .hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  @media (max-width: 720px) { .hero-stats { grid-template-columns: repeat(2, 1fr); } }
  .hero-stat {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 24px 20px;
  }
  .hero-stat-value {
    font-size: 32px; font-weight: 800; letter-spacing: -0.8px;
    font-variant-numeric: tabular-nums;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .hero-stat-label { color: var(--muted); font-size: 13px; margin-top: 4px; }

  /* SECTION BASE */
  section { padding: 56px 0; }
  .section-label {
    display: inline-block; font-size: 11px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase; color: var(--accent);
    margin-bottom: 12px;
  }
  .section-title {
    font-size: clamp(24px, 4vw, 32px); font-weight: 700;
    letter-spacing: -0.5px; margin-bottom: 8px;
  }
  .section-lede { color: var(--muted); font-size: 16px; max-width: 640px; margin-bottom: 32px; }

  /* MURO DE VOCES (T1.1) — review wall */
  .muro { border-top: 1px solid var(--border); }
  .muro-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .quote-card {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 18px; transition: transform .2s, border-color .2s;
    display: flex; flex-direction: column; gap: 12px; min-height: 160px;
  }
  .quote-card:hover { transform: translateY(-2px); border-color: var(--border-hover); }
  .quote-card.s1 { border-left: 3px solid var(--danger); }
  .quote-card.s2 { border-left: 3px solid #ff7a6b; }
  .quote-card.s3 { border-left: 3px solid var(--warning); }
  .quote-card.s4 { border-left: 3px solid #a7c957; }
  .quote-card.s5 { border-left: 3px solid var(--success); }
  .quote-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; color: var(--muted);
  }
  .quote-vertical {
    text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; color: var(--accent);
  }
  .quote-stars { font-family: 'JetBrains Mono', monospace; letter-spacing: 2px; }
  .quote-text {
    font-size: 14px; line-height: 1.5; font-style: italic; color: var(--text);
    flex: 1;
  }
  .quote-source {
    font-size: 11px; color: var(--muted-2); margin-top: auto;
    font-family: 'JetBrains Mono', monospace;
  }

  /* FIRE DRILLS */
  .drill-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  @media (max-width: 900px) { .drill-grid { grid-template-columns: 1fr; } }
  .drill {
    background: var(--card); border: 1px solid var(--border); border-radius: 20px;
    padding: 28px; position: relative; overflow: hidden;
    transition: transform .2s, border-color .2s;
  }
  .drill:hover { transform: translateY(-2px); border-color: var(--border-hover); }
  .drill::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
  }
  .drill-rank {
    position: absolute; top: 20px; right: 24px;
    font-weight: 800; font-size: 11px; color: var(--muted-2);
    font-variant-numeric: tabular-nums; letter-spacing: 2px;
  }
  .drill-vertical {
    text-transform: uppercase; font-size: 11px; letter-spacing: 2px;
    color: var(--accent); font-weight: 700; margin-bottom: 12px;
  }
  .drill-headline {
    font-size: 22px; font-weight: 700; letter-spacing: -0.4px;
    line-height: 1.25; margin-bottom: 20px; min-height: 56px;
  }
  .drill-stat { display: flex; gap: 20px; margin-bottom: 20px; }
  .drill-stat .kv { display: flex; flex-direction: column; }
  .drill-stat .v { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .drill-stat .k {
    color: var(--muted); font-size: 11px; text-transform: uppercase;
    letter-spacing: 1px; margin-top: 2px;
  }
  .drill-cluster {
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px; font-size: 13px;
  }
  .drill-cluster .theme { font-weight: 600; margin-bottom: 6px; line-height: 1.35; }
  .drill-cluster .quote { color: var(--muted); font-style: italic; font-size: 12px; line-height: 1.45; }

  /* VERTICALS GRID */
  .v-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;
  }
  .v-card {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 20px; text-decoration: none; color: inherit; transition: all .15s;
    display: flex; flex-direction: column; cursor: pointer;
  }
  .v-card:hover {
    background: var(--card-hover); border-color: var(--border-hover);
    transform: translateY(-2px);
  }
  .v-name {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 2px; color: var(--accent); margin-bottom: 8px;
  }
  .v-total {
    font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
    font-variant-numeric: tabular-nums;
  }
  .v-total small { font-size: 12px; color: var(--muted); font-weight: 500; margin-left: 6px; }
  .v-neg-label { font-size: 11px; color: var(--muted); margin: 16px 0 6px; font-weight: 500; }
  .bar-track { background: var(--bg-2); border-radius: 999px; height: 8px; overflow: hidden; }
  .bar-fill {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    height: 100%; border-radius: 999px; transition: width .6s ease-out;
  }
  .v-pains { margin-top: 16px; font-size: 12px; }
  .v-pain { display: flex; justify-content: space-between; margin-bottom: 4px; color: var(--muted); }
  .v-pain b { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 600; }
  .v-link {
    margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);
    color: var(--accent); font-size: 13px; font-weight: 600;
  }

  /* EXPLORER (T2.4) — interactive vertical tabs */
  .explorer { border-top: 1px solid var(--border); }
  .tabs {
    display: flex; gap: 6px; margin-bottom: 24px; overflow-x: auto;
    padding-bottom: 6px; border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex-shrink: 0; padding: 10px 18px; border-radius: 999px;
    background: transparent; border: 1px solid var(--border);
    color: var(--muted); font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all .15s; font-family: inherit;
  }
  .tab:hover { color: var(--text); border-color: var(--border-hover); }
  .tab.active {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff; border-color: transparent;
  }
  .tab .count {
    display: inline-block; margin-left: 8px; font-size: 11px;
    font-variant-numeric: tabular-nums; opacity: .75;
  }
  .tab-panel { display: none; animation: fadeIn .3s ease; }
  .tab-panel.active { display: block; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .panel-meta {
    display: flex; gap: 28px; margin-bottom: 28px; flex-wrap: wrap;
    padding: 16px 20px; background: var(--bg-2); border: 1px solid var(--border);
    border-radius: 12px;
  }
  .panel-meta .meta-k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .panel-meta .meta-v { color: var(--text); font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .panel-meta .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .panel-cols { display: grid; grid-template-columns: 1fr 1.5fr; gap: 32px; }
  @media (max-width: 900px) { .panel-cols { grid-template-columns: 1fr; } }
  .panel-col h4 {
    margin-bottom: 16px; font-size: 11px; text-transform: uppercase;
    letter-spacing: 1.5px; color: var(--muted); font-weight: 600;
  }
  .pain-bar { margin-bottom: 14px; }
  .pain-bar .head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
  .pain-bar .head b { font-variant-numeric: tabular-nums; font-weight: 600; }
  .cluster-card {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 18px; margin-bottom: 12px;
  }
  .cluster-card .theme-row {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px; margin-bottom: 8px;
  }
  .cluster-card .theme { font-weight: 600; font-size: 15px; line-height: 1.35; }
  .cluster-card .count {
    background: var(--accent-soft); color: var(--accent); font-weight: 700;
    font-size: 11px; padding: 3px 10px; border-radius: 999px;
    font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;
  }
  .cluster-card .quote {
    color: var(--muted); font-style: italic; font-size: 13px; line-height: 1.5;
    padding: 10px 14px; background: var(--bg-2); border-radius: 10px;
    border-left: 2px solid var(--accent); margin-top: 10px;
  }

  /* BOT */
  .bot-wrap {
    background: radial-gradient(ellipse at center, rgba(255, 111, 60, 0.08), transparent 60%);
    border-radius: 24px; padding: 48px 40px; margin: 24px 0;
    border: 1px solid var(--border);
  }
  .bot-grid { display: grid; grid-template-columns: 260px 1fr; gap: 48px; align-items: center; }
  @media (max-width: 720px) {
    .bot-grid { grid-template-columns: 1fr; text-align: center; gap: 32px; }
    .qr-wrap { margin: 0 auto; }
  }
  .qr-wrap {
    background: var(--card); border: 1px solid var(--border); border-radius: 20px;
    padding: 20px; display: flex; flex-direction: column;
    align-items: center; gap: 12px; max-width: 280px;
  }
  .qr-wrap img { border-radius: 12px; display: block; }
  .qr-wrap .tag { font-size: 13px; color: var(--muted); font-family: 'JetBrains Mono', monospace; font-weight: 500; }
  .bot-grid h2 { font-size: clamp(24px, 4vw, 32px); font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
  .bot-grid .lede { color: var(--muted); font-size: 15px; margin-bottom: 20px; max-width: 540px; }
  .bot-commands {
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px;
    padding: 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px;
    margin-bottom: 24px; text-align: left;
  }
  .bot-commands .cmd { margin: 6px 0; line-height: 1.6; }
  .bot-commands code {
    color: var(--accent); font-weight: 600;
    background: rgba(255, 111, 60, 0.1); padding: 2px 8px; border-radius: 4px;
  }
  .bot-commands span { color: var(--muted); margin-left: 4px; }
  .bot-cta {
    display: inline-flex; align-items: center; gap: 8px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 999px;
    font-weight: 600; font-size: 14px; transition: transform .15s;
  }
  .bot-cta:hover { transform: translateY(-1px); }

  /* METHOD / ARCHITECTURE (T3.8) — interactive SVG */
  .method { border-top: 1px solid var(--border); }
  .method-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
  @media (max-width: 900px) { .method-grid { grid-template-columns: 1fr; } }
  .method p { color: var(--muted); margin-bottom: 16px; font-size: 15px; line-height: 1.7; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; margin-bottom: 16px; }
  .pill {
    background: var(--card); border: 1px solid var(--border); border-radius: 999px;
    padding: 6px 14px; font-size: 13px; font-weight: 500;
  }
  .method-link {
    display: inline-flex; align-items: center; gap: 6px; color: var(--accent);
    text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;
  }
  .method-link:hover { text-decoration: underline; }
  .arch-svg {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 24px; overflow: visible; width: 100%; height: auto;
  }
  .arch-node rect {
    fill: var(--bg-2); stroke: var(--border); stroke-width: 1;
    transition: fill .2s, stroke .2s;
  }
  .arch-node:hover rect { fill: var(--accent-soft); stroke: var(--accent); cursor: help; }
  .arch-node text { fill: var(--text); font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; pointer-events: none; }
  .arch-node text.sub { fill: var(--muted); font-size: 10px; font-weight: 400; }
  .arch-arrow line { stroke: var(--muted-2); stroke-width: 1.5; }
  .arch-arrow polygon { fill: var(--muted-2); }
  .arch-tooltip {
    fill: var(--bg); stroke: var(--accent); stroke-width: 1;
    rx: 6; ry: 6;
  }
  .arch-tooltip-text { fill: var(--text); font-size: 11px; font-family: 'Inter', sans-serif; }

  /* HABLEMOS (T4.9) */
  .hablemos { border-top: 1px solid var(--border); padding: 80px 0; }
  .hablemos-wrap {
    background: linear-gradient(135deg, rgba(255, 111, 60, 0.08), rgba(255, 45, 135, 0.05));
    border: 1px solid var(--border); border-radius: 24px;
    padding: 56px 48px;
    display: grid; grid-template-columns: 200px 1fr; gap: 40px; align-items: center;
  }
  @media (max-width: 720px) {
    .hablemos-wrap { grid-template-columns: 1fr; text-align: center; padding: 40px 28px; gap: 24px; }
    .hablemos-avatar { margin: 0 auto; }
  }
  .hablemos-avatar {
    width: 180px; height: 180px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: flex; align-items: center; justify-content: center;
    font-size: 72px; font-weight: 800; color: #fff;
    letter-spacing: -2px; overflow: hidden;
  }
  .hablemos h2 { font-size: clamp(26px, 4vw, 36px); font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
  .hablemos p { color: var(--muted); font-size: 16px; margin-bottom: 20px; max-width: 560px; }
  .hablemos-ctas { display: flex; gap: 12px; flex-wrap: wrap; }
  @media (max-width: 720px) { .hablemos-ctas { justify-content: center; } }
  .btn-primary {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 999px;
    font-weight: 600; font-size: 14px; transition: transform .15s;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn-primary:hover { transform: translateY(-1px); }
  .btn-ghost {
    background: transparent; color: var(--text);
    border: 1px solid var(--border); padding: 12px 22px; border-radius: 999px;
    text-decoration: none; font-weight: 600; font-size: 14px;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn-ghost:hover { border-color: var(--border-hover); }

  /* FOOTER */
  footer {
    border-top: 1px solid var(--border); padding: 40px 0;
    color: var(--muted-2); font-size: 13px;
  }
  .footer-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; align-items: center; }
  .footer-row a { color: var(--muted); text-decoration: none; margin-right: 16px; }
  .footer-row a:hover { color: var(--text); }
  .disclaimer { margin-top: 20px; font-size: 12px; color: var(--muted-2); line-height: 1.7; }

  .loading, .error { text-align: center; padding: 48px 24px; color: var(--muted); font-size: 14px; }
  .error { color: var(--danger); }
</style>
</head>
<body>

<!-- T1.3 Live ticker -->
<div class="ticker">
  <div class="ticker-inner">
    <span class="ticker-pulse"></span>
    <span class="ticker-text" id="ticker-text"><span class="tag">agente · classifier</span><strong>Inicializando…</strong></span>
  </div>
</div>

<nav>
  <div class="container nav-inner">
    <div class="logo"><span class="grad">Voz del Cliente</span> · Rappi MX</div>
    <div class="nav-links">
      <a href="#muro">Voces</a>
      <a href="#hallazgos">Hallazgos</a>
      <a href="#explorer">Verticales</a>
      <a href="#bot">Bot</a>
      <a href="#metodologia">Cómo se hizo</a>
      <a href="https://t.me/Rappi_demo_bot" target="_blank" rel="noopener" class="nav-cta">Probar el bot →</a>
    </div>
  </div>
</nav>

<section class="hero">
  <div class="container">
    <span class="hero-tag">Demo AI Builder · Alex Friedlander</span>
    <h1>Reseñas de Rappi México,<br><span class="grad">analizadas por agentes de IA.</span></h1>
    <p class="hero-sub">Un pipeline que extrae reseñas públicas de Google Play, las clasifica por vertical y causa raíz con Claude, y agrupa patrones semanales con citas reales. Cuatro horas de desarrollo para mostrar qué tipo de herramienta puede desplegar el AI Squad interno de Rappi en una iteración corta.</p>
    <div class="hero-stats" id="hero-stats">
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Reseñas analizadas</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Negativas</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Verticales</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Clusters</div></div>
    </div>
  </div>
</section>

<!-- T1.1 Muro de voces -->
<section id="muro" class="muro">
  <div class="container">
    <span class="section-label">Muro de voces</span>
    <h2 class="section-title">Lo que dicen los clientes, sin filtro</h2>
    <p class="section-lede">Citas reales de reseñas públicas, clasificadas por vertical y sentiment. El agente no inventa: extrae textual.</p>
    <div class="muro-grid" id="muro-grid"><div class="loading">Cargando voces…</div></div>
  </div>
</section>

<section id="hallazgos">
  <div class="container">
    <span class="section-label">Hallazgos</span>
    <h2 class="section-title">Lo que aparece en la data</h2>
    <p class="section-lede">Tres señales que un agente interno priorizaría primero. Citas reales de reseñas públicas, anonimizadas.</p>
    <div class="drill-grid" id="drill-grid"><div class="loading">Cargando hallazgos…</div></div>
  </div>
</section>

<section id="verticales">
  <div class="container">
    <span class="section-label">Verticales</span>
    <h2 class="section-title">Las verticales del dataset</h2>
    <p class="section-lede">Haz clic en cualquier vertical para abrir el explorador interactivo con pain points y clusters.</p>
    <div class="v-grid" id="v-grid"><div class="loading">Cargando verticales…</div></div>
  </div>
</section>

<!-- T2.4 Interactive vertical explorer -->
<section id="explorer" class="explorer">
  <div class="container">
    <span class="section-label">Explorador</span>
    <h2 class="section-title">Detalle por vertical</h2>
    <p class="section-lede">Cambia de pestaña para ver pain points completos y clusters con citas reales.</p>
    <div class="tabs" id="tabs" role="tablist"></div>
    <div id="panels"></div>
  </div>
</section>

<section id="bot">
  <div class="container">
    <div class="bot-wrap">
      <div class="bot-grid">
        <div class="qr-wrap">
          <img src="https://api.qrserver.com/v1/create-qr-code/?data=https%3A%2F%2Ft.me%2FRappi_demo_bot&size=220x220&bgcolor=21-21-32&color=FF6F3C&margin=8" width="220" height="220" alt="QR a @Rappi_demo_bot" loading="lazy">
          <span class="tag">@Rappi_demo_bot</span>
        </div>
        <div>
          <span class="section-label">Bot de Telegram</span>
          <h2>Consulta los briefs desde el móvil</h2>
          <p class="lede">El bot lee del mismo conjunto de datos que este dashboard. Añádelo, envía <code style="font-family:'JetBrains Mono',monospace;color:var(--accent)">/digest</code> y recibes la síntesis en español. Útil para revisar fire drills en una reunión.</p>
          <div class="bot-commands">
            <div class="cmd"><code>/digest</code><span>— top 5 fire drills de la semana</span></div>
            <div class="cmd"><code>/vertical &lt;nombre&gt;</code><span>— detalle por vertical</span></div>
            <div class="cmd"><code>/help</code><span>— lista de comandos</span></div>
          </div>
          <a href="https://t.me/Rappi_demo_bot" target="_blank" rel="noopener" class="bot-cta">Abrir en Telegram →</a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- T3.8 Interactive architecture + methodology -->
<section id="metodologia" class="method">
  <div class="container">
    <span class="section-label">Metodología</span>
    <h2 class="section-title">Cómo se hizo</h2>
    <div class="method-grid">
      <div>
        <p>El pipeline extrae reseñas públicas de Google Play con varios actores de Apify, las persiste en Supabase con Row-Level Security, y ejecuta dos agentes de Claude en secuencia: el primero clasifica cada reseña (vertical, pain point, sentiment, resumen en español); el segundo agrupa las negativas de la semana en clusters de causa raíz con citas reales.</p>
        <p>El dashboard y el bot leen del mismo modelo de datos a través de la anon key, protegida por RLS. Cero secretos en el repositorio público: todo se gestiona como wrangler secrets.</p>
        <div class="pills">
          <span class="pill">Claude</span>
          <span class="pill">Apify</span>
          <span class="pill">Supabase</span>
          <span class="pill">Cloudflare Workers</span>
          <span class="pill">MCP</span>
          <span class="pill">TypeScript</span>
          <span class="pill">Telegram Bot API</span>
        </div>
        <a href="https://github.com/wuirifriskys/voz-del-cliente-rappi-demo" target="_blank" rel="noopener" class="method-link">Ver código en GitHub →</a>
      </div>
      <div>
        <svg class="arch-svg" viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagrama de arquitectura">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <polygon points="0,0 10,5 0,10" fill="#6b6b80"></polygon>
            </marker>
          </defs>
          <!-- Nodo: Apify -->
          <g class="arch-node">
            <rect x="120" y="10" width="160" height="48" rx="10"></rect>
            <text x="200" y="32" text-anchor="middle">Apify scrapers</text>
            <text x="200" y="48" class="sub" text-anchor="middle">Google Play · 3 actores</text>
            <title>Extrae reseñas públicas de Google Play. Varios actores en paralelo para ampliar cuota y volumen.</title>
          </g>
          <line x1="200" y1="58" x2="200" y2="82" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>

          <!-- Nodo: raw_reviews -->
          <g class="arch-node">
            <rect x="110" y="92" width="180" height="48" rx="10"></rect>
            <text x="200" y="114" text-anchor="middle">Supabase · raw_reviews</text>
            <text x="200" y="130" class="sub" text-anchor="middle">RLS activo, solo service role escribe</text>
            <title>Tabla con las reseñas tal cual llegan del scraping. RLS bloquea lectura anon — solo el backend ve el raw.</title>
          </g>
          <line x1="200" y1="140" x2="200" y2="164" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>

          <!-- Nodo: Classifier -->
          <g class="arch-node">
            <rect x="100" y="174" width="200" height="48" rx="10"></rect>
            <text x="200" y="196" text-anchor="middle">Agente clasificador (Claude)</text>
            <text x="200" y="212" class="sub" text-anchor="middle">vertical · pain_point · sentiment</text>
            <title>Agente Claude con prompt estructurado. Devuelve vertical, pain point, sentiment 1-5 y resumen en español por cada reseña.</title>
          </g>
          <line x1="200" y1="222" x2="200" y2="246" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>

          <!-- Nodo: Clusterer -->
          <g class="arch-node">
            <rect x="100" y="256" width="200" height="48" rx="10"></rect>
            <text x="200" y="278" text-anchor="middle">Agente clusterer (Claude)</text>
            <text x="200" y="294" class="sub" text-anchor="middle">temas + citas semanales</text>
            <title>Agrupa las reseñas negativas de la semana en clusters de causa raíz. Cada cluster incluye un tema y una cita textual real.</title>
          </g>
          <line x1="200" y1="304" x2="200" y2="328" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>

          <!-- Nodo: weekly_briefs -->
          <g class="arch-node">
            <rect x="110" y="338" width="180" height="48" rx="10"></rect>
            <text x="200" y="360" text-anchor="middle">Supabase · weekly_briefs</text>
            <text x="200" y="376" class="sub" text-anchor="middle">anon puede leer (RLS filtrado)</text>
            <title>Tabla de agregados. Policy RLS permite a anon SELECT. El dashboard y el bot leen solo esta tabla.</title>
          </g>

          <!-- Salidas: Dashboard + Bot -->
          <line x1="160" y1="386" x2="100" y2="402" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>
          <line x1="240" y1="386" x2="300" y2="402" stroke="#6b6b80" stroke-width="1.5" marker-end="url(#arrow)"></line>
          <g class="arch-node">
            <rect x="20" y="400" width="130" height="18" rx="6"></rect>
            <text x="85" y="413" text-anchor="middle">Dashboard (Worker)</text>
            <title>Este dashboard. Cloudflare Worker sirve HTML + /api/briefs público.</title>
          </g>
          <g class="arch-node">
            <rect x="250" y="400" width="130" height="18" rx="6"></rect>
            <text x="315" y="413" text-anchor="middle">Bot de Telegram</text>
            <title>Webhook de Telegram en el mismo Worker. Responde /digest y /vertical leyendo weekly_briefs.</title>
          </g>
        </svg>
      </div>
    </div>
  </div>
</section>

<!-- T4.9 Hablemos CTA -->
<section id="hablemos" class="hablemos">
  <div class="container">
    <div class="hablemos-wrap">
      <div class="hablemos-avatar" aria-hidden="true">AF</div>
      <div>
        <span class="section-label">Hablemos</span>
        <h2>Si este tipo de cosas te suena útil en Rappi, me contactas.</h2>
        <p>Soy Alex Friedlander. Vengo de Alfa/Accenture (4 años rediseñando operaciones en Iberdrola, Avangrid, EDPR) y monté la expansión APAC de una empresa de soluciones de IA. Hoy diseño y despliego sistemas de IA en producción, no los advierto desde el otro lado de la mesa.</p>
        <div class="hablemos-ctas">
          <a href="https://linkedin.com/in/alex-friedlander-a3766197" target="_blank" rel="noopener" class="btn-primary">Escribir por LinkedIn →</a>
          <a href="mailto:alexfriedlanderpascual@gmail.com" class="btn-ghost">Email</a>
          <a href="https://github.com/wuirifriskys" target="_blank" rel="noopener" class="btn-ghost">GitHub</a>
        </div>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-row">
      <div>
        <a href="https://github.com/wuirifriskys/voz-del-cliente-rappi-demo" target="_blank" rel="noopener">Código</a>
        <a href="https://linkedin.com/in/alex-friedlander-a3766197" target="_blank" rel="noopener">LinkedIn</a>
        <a href="https://t.me/Rappi_demo_bot" target="_blank" rel="noopener">Telegram Bot</a>
      </div>
      <div>Alex Friedlander · 2026</div>
    </div>
    <p class="disclaimer">Demo independiente · no afiliada a Rappi. Basada en reseñas públicas de Google Play México. El dashboard publica sólo agregados y clusters anonimizados. Si Rappi solicita retirarlo, se apaga el mismo día.</p>
  </div>
</footer>

<script>
  const VERTICAL_LABELS = {
    food: 'Food', grocery: 'Grocery', pharmacy: 'Pharmacy',
    rappipay: 'RappiPay', courier: 'Courier', app: 'App', other: 'Other',
  };
  const PAIN_LABELS = {
    late_delivery: 'Entrega tardía', missing_item: 'Falta producto',
    wrong_item: 'Producto incorrecto', app_bug: 'Error de app',
    payment_failure: 'Fallo de pago', support_unresponsive: 'Soporte no responde',
    courier_behavior: 'Comportamiento del repartidor',
    price_complaint: 'Queja de precio', other: 'Otro',
  };
  const DRILL_RANK = ['rappipay', 'courier', 'app', 'food', 'grocery', 'pharmacy', 'other'];

  let allQuotes = [];

  (async () => {
    try {
      const res = await fetch('/api/briefs');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const briefs = (data.briefs || []);
      if (briefs.length === 0) {
        document.getElementById('drill-grid').innerHTML = '<div class="loading">Sin datos aún. El pipeline corre semanalmente.</div>';
        startTicker([]);
        return;
      }
      const latestWeek = briefs[0].week_start;
      const thisWeek = briefs.filter(b => b.week_start === latestWeek);
      renderHeroStats(thisWeek);
      renderMuro(thisWeek);
      renderDrills(thisWeek);
      renderVerticals(thisWeek);
      renderExplorer(thisWeek);
      startTicker(thisWeek);
    } catch (err) {
      document.getElementById('drill-grid').innerHTML = '<div class="error">Error cargando: ' + escapeHtml(err.message) + '</div>';
      startTicker([]);
    }
  })();

  function renderHeroStats(briefs) {
    const total = briefs.reduce((s, b) => s + b.total_reviews, 0);
    const totalNeg = briefs.reduce((s, b) => s + Math.round(b.total_reviews * b.negative_share), 0);
    const clusters = briefs.reduce((s, b) => s + (b.clusters ? b.clusters.length : 0), 0);
    const negShare = total ? Math.round(totalNeg / total * 100) : 0;
    const stats = [
      { v: total.toLocaleString('es-MX'), k: 'Reseñas analizadas' },
      { v: negShare + '%', k: 'Negativas' },
      { v: briefs.length, k: 'Verticales' },
      { v: clusters, k: 'Clusters' },
    ];
    document.getElementById('hero-stats').innerHTML = stats.map(x =>
      '<div class="hero-stat"><div class="hero-stat-value">' + x.v + '</div><div class="hero-stat-label">' + x.k + '</div></div>'
    ).join('');
  }

  function collectQuotes(briefs) {
    const quotes = [];
    briefs.forEach(b => {
      (b.clusters || []).forEach(c => {
        if (c.example_quote) {
          quotes.push({
            text: c.example_quote,
            vertical: b.vertical,
            theme: c.theme,
            sentiment: 1, // cluster quotes are from negative reviews
          });
        }
      });
    });
    return quotes;
  }

  function renderMuro(briefs) {
    const quotes = collectQuotes(briefs);
    allQuotes = quotes;
    if (quotes.length === 0) {
      document.getElementById('muro-grid').innerHTML = '<div class="loading">Sin citas aún.</div>';
      return;
    }
    // Shuffle for visual variety
    const shuffled = quotes.map(q => q).sort(() => Math.random() - 0.5);
    document.getElementById('muro-grid').innerHTML = shuffled.map(q => {
      const verticalLabel = VERTICAL_LABELS[q.vertical] || q.vertical;
      const stars = '★'.repeat(q.sentiment) + '☆'.repeat(5 - q.sentiment);
      return '<div class="quote-card s' + q.sentiment + '">' +
        '<div class="quote-head">' +
          '<span class="quote-vertical">' + verticalLabel + '</span>' +
          '<span class="quote-stars">' + stars + '</span>' +
        '</div>' +
        '<div class="quote-text">"' + escapeHtml(q.text) + '"</div>' +
        '<div class="quote-source">' + escapeHtml(q.theme.toLowerCase().slice(0, 60)) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderDrills(briefs) {
    const sorted = briefs
      .filter(b => b.vertical !== 'other')
      .sort((a, b) => DRILL_RANK.indexOf(a.vertical) - DRILL_RANK.indexOf(b.vertical))
      .slice(0, 3);
    document.getElementById('drill-grid').innerHTML = sorted.map((b, i) => {
      const topPain = (b.top_pain_points || [])[0];
      const topCluster = (b.clusters || [])[0];
      const negPct = Math.round(b.negative_share * 100);
      const painPct = topPain ? Math.round(topPain.share * 100) : 0;
      const painLabel = topPain ? (PAIN_LABELS[topPain.pain_point] || topPain.pain_point) : '';
      return '<div class="drill">' +
        '<div class="drill-rank">0' + (i + 1) + '</div>' +
        '<div class="drill-vertical">' + (VERTICAL_LABELS[b.vertical] || b.vertical) + '</div>' +
        '<div class="drill-headline">' + buildHeadline(negPct, painPct, painLabel) + '</div>' +
        '<div class="drill-stat">' +
          '<div class="kv"><span class="v">' + b.total_reviews + '</span><span class="k">Reseñas</span></div>' +
          '<div class="kv"><span class="v">' + negPct + '%</span><span class="k">Negativas</span></div>' +
          (topPain ? '<div class="kv"><span class="v">' + painPct + '%</span><span class="k">' + escapeHtml(painLabel) + '</span></div>' : '') +
        '</div>' +
        (topCluster ? '<div class="drill-cluster"><div class="theme">' + escapeHtml(topCluster.theme) + '</div>' +
          (topCluster.example_quote ? '<div class="quote">&ldquo;' + escapeHtml(topCluster.example_quote) + '&rdquo;</div>' : '') +
        '</div>' : '') +
      '</div>';
    }).join('');
  }

  function buildHeadline(negPct, painPct, painLabel) {
    if (!painLabel) return negPct + '% de las reseñas son negativas.';
    return negPct + '% negativas. ' + painPct + '% son ' + painLabel.toLowerCase() + '.';
  }

  function renderVerticals(briefs) {
    document.getElementById('v-grid').innerHTML = briefs.map(b => {
      const negPct = Math.round(b.negative_share * 100);
      const pains = (b.top_pain_points || []).slice(0, 3).map(p => {
        const pct = Math.round(p.share * 100);
        const label = PAIN_LABELS[p.pain_point] || p.pain_point;
        return '<div class="v-pain"><span>' + escapeHtml(label) + '</span><b>' + pct + '%</b></div>';
      }).join('');
      return '<a href="#explorer" class="v-card" data-vertical="' + b.vertical + '">' +
        '<div class="v-name">' + (VERTICAL_LABELS[b.vertical] || b.vertical) + '</div>' +
        '<div class="v-total">' + b.total_reviews + '<small>reseñas</small></div>' +
        '<div class="v-neg-label">' + negPct + '% negativas</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + negPct + '%"></div></div>' +
        '<div class="v-pains">' + pains + '</div>' +
        '<div class="v-link">Ver detalle ↓</div>' +
      '</a>';
    }).join('');
    // Vertical card click → activate tab in explorer
    document.querySelectorAll('.v-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const v = card.dataset.vertical;
        setTimeout(() => activateTab(v), 100);
      });
    });
  }

  function renderExplorer(briefs) {
    const tabsEl = document.getElementById('tabs');
    const panelsEl = document.getElementById('panels');
    tabsEl.innerHTML = briefs.map((b, i) =>
      '<button class="tab' + (i === 0 ? ' active' : '') + '" data-vertical="' + b.vertical + '" role="tab">' +
        (VERTICAL_LABELS[b.vertical] || b.vertical) +
        '<span class="count">' + b.total_reviews + '</span>' +
      '</button>'
    ).join('');
    panelsEl.innerHTML = briefs.map((b, i) => renderPanel(b, i === 0)).join('');
    // Wire up tabs
    tabsEl.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => activateTab(t.dataset.vertical));
    });
    // Handle initial hash
    if (location.hash && location.hash.startsWith('#v-')) {
      const v = location.hash.replace('#v-', '');
      activateTab(v);
    }
  }

  function activateTab(vertical) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.vertical === vertical);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.vertical === vertical);
    });
    if (location.hash !== '#v-' + vertical) {
      history.replaceState(null, '', '#v-' + vertical);
    }
  }

  function renderPanel(b, isActive) {
    const negPct = Math.round(b.negative_share * 100);
    const topPain = (b.top_pain_points || [])[0];
    const topPainLabel = topPain ? (PAIN_LABELS[topPain.pain_point] || topPain.pain_point) : '—';
    const painBars = (b.top_pain_points || []).map(p => {
      const pct = Math.round(p.share * 100);
      const label = PAIN_LABELS[p.pain_point] || p.pain_point;
      return '<div class="pain-bar"><div class="head"><span>' + escapeHtml(label) + '</span><b>' + p.count + ' · ' + pct + '%</b></div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>';
    }).join('');
    const clusters = (b.clusters || []).map(c =>
      '<div class="cluster-card">' +
        '<div class="theme-row">' +
          '<div class="theme">' + escapeHtml(c.theme) + '</div>' +
          '<div class="count">' + c.count + '</div>' +
        '</div>' +
        (c.example_quote ? '<div class="quote">&ldquo;' + escapeHtml(c.example_quote) + '&rdquo;</div>' : '') +
      '</div>'
    ).join('');
    return '<div class="tab-panel' + (isActive ? ' active' : '') + '" data-vertical="' + b.vertical + '" role="tabpanel">' +
      '<div class="panel-meta">' +
        '<div class="meta-item"><span class="meta-k">Reseñas</span><span class="meta-v">' + b.total_reviews + '</span></div>' +
        '<div class="meta-item"><span class="meta-k">Negativas</span><span class="meta-v">' + negPct + '%</span></div>' +
        '<div class="meta-item"><span class="meta-k">Top pain point</span><span class="meta-v">' + escapeHtml(topPainLabel) + '</span></div>' +
        '<div class="meta-item"><span class="meta-k">Semana</span><span class="meta-v">' + escapeHtml(b.week_start) + '</span></div>' +
      '</div>' +
      '<div class="panel-cols">' +
        '<div class="panel-col"><h4>Distribución de pain points</h4>' + painBars + '</div>' +
        '<div class="panel-col"><h4>Clusters de causa raíz</h4>' + clusters + '</div>' +
      '</div>' +
    '</div>';
  }

  function startTicker(briefs) {
    const el = document.getElementById('ticker-text');
    const snippets = [];
    briefs.forEach(b => {
      (b.clusters || []).forEach(c => {
        snippets.push({ tag: VERTICAL_LABELS[b.vertical] || b.vertical, text: c.theme });
      });
      (b.top_pain_points || []).forEach(p => {
        snippets.push({ tag: VERTICAL_LABELS[b.vertical] || b.vertical, text: (PAIN_LABELS[p.pain_point] || p.pain_point) + ' · ' + p.count + ' reseñas' });
      });
    });
    if (snippets.length === 0) {
      el.innerHTML = '<span class="tag">agente · idle</span><strong>Sin datos</strong>';
      return;
    }
    let i = 0;
    const render = () => {
      const s = snippets[i % snippets.length];
      el.style.opacity = '0';
      setTimeout(() => {
        el.innerHTML = '<span class="tag">' + escapeHtml(s.tag) + '</span><strong>' + escapeHtml(s.text) + '</strong>';
        el.style.opacity = '1';
      }, 250);
      i++;
    };
    render();
    setInterval(render, 3200);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
</script>
</body>
</html>`;
}
