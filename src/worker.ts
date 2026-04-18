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
<title>Voz del Cliente — Rappi MX | Análisis de reseñas con AI</title>
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
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 70px; }
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
  @media (max-width: 720px) { .nav-links a:not(.nav-cta) { display: none; } }

  /* HERO */
  .hero { padding: 80px 0 56px; }
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

  /* SECTIONS */
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
  .drill-stat .v {
    font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
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
  .bar-track {
    background: var(--bg-2); border-radius: 999px; height: 8px; overflow: hidden;
  }
  .bar-fill {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    height: 100%; border-radius: 999px; transition: width .6s ease-out;
  }
  .v-pains { margin-top: 16px; font-size: 12px; }
  .v-pain {
    display: flex; justify-content: space-between; margin-bottom: 4px;
    color: var(--muted);
  }
  .v-pain b { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 600; }
  .v-link {
    margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);
    color: var(--accent); font-size: 13px; font-weight: 600;
  }

  /* DEEP DIVES */
  .deep { border-top: 1px solid var(--border); padding: 56px 0; }
  .deep-header {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 24px; flex-wrap: wrap; gap: 16px;
  }
  .deep-header h3 {
    font-size: clamp(22px, 3vw, 28px); font-weight: 700; letter-spacing: -0.5px;
  }
  .deep-header .back {
    color: var(--muted); font-size: 13px; text-decoration: none;
    transition: color .15s;
  }
  .deep-header .back:hover { color: var(--text); }
  .deep-meta {
    display: flex; gap: 28px; margin-bottom: 28px; flex-wrap: wrap;
    padding: 16px 20px; background: var(--bg-2); border: 1px solid var(--border);
    border-radius: 12px;
  }
  .deep-meta .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .deep-meta .meta-k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .deep-meta .meta-v { color: var(--text); font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .deep-cols { display: grid; grid-template-columns: 1fr 1.5fr; gap: 32px; }
  @media (max-width: 900px) { .deep-cols { grid-template-columns: 1fr; } }
  .deep-col h4 {
    margin-bottom: 16px; font-size: 11px; text-transform: uppercase;
    letter-spacing: 1.5px; color: var(--muted); font-weight: 600;
  }
  .pain-bar { margin-bottom: 14px; }
  .pain-bar .head {
    display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;
  }
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
  .qr-wrap .tag {
    font-size: 13px; color: var(--muted);
    font-family: 'JetBrains Mono', monospace; font-weight: 500;
  }
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

  /* METHOD */
  .method { border-top: 1px solid var(--border); }
  .method-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
  @media (max-width: 900px) { .method-grid { grid-template-columns: 1fr; } }
  .method p { color: var(--muted); margin-bottom: 16px; font-size: 15px; line-height: 1.7; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; margin-bottom: 16px; }
  .pill {
    background: var(--card); border: 1px solid var(--border); border-radius: 999px;
    padding: 6px 14px; font-size: 13px; font-weight: 500;
  }
  .method-arch {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 20px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
    color: var(--muted); overflow-x: auto; white-space: pre; line-height: 1.55;
  }
  .method-link {
    display: inline-flex; align-items: center; gap: 6px; color: var(--accent);
    text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;
  }
  .method-link:hover { text-decoration: underline; }

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

<nav>
  <div class="container nav-inner">
    <div class="logo"><span class="grad">Voz del Cliente</span> · Rappi MX</div>
    <div class="nav-links">
      <a href="#hallazgos">Hallazgos</a>
      <a href="#verticales">Verticales</a>
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
    <p class="hero-sub">Un pipeline que extrae reseñas públicas de App Store y Google Play, las clasifica por vertical y causa raíz con Claude, y agrupa patrones semanales con citas reales. Cuatro horas de desarrollo para mostrar qué tipo de herramienta puede desplegar el AI Squad interno de Rappi en una iteración corta.</p>
    <div class="hero-stats" id="hero-stats">
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Reseñas analizadas</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Negativas</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Verticales</div></div>
      <div class="hero-stat"><div class="hero-stat-value">—</div><div class="hero-stat-label">Clusters</div></div>
    </div>
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
    <h2 class="section-title">Las 5 verticales del dataset</h2>
    <p class="section-lede">Haz clic en cualquier vertical para ver pain points completos y clusters con citas reales.</p>
    <div class="v-grid" id="v-grid"><div class="loading">Cargando verticales…</div></div>
  </div>
</section>

<div id="deep-dives"></div>

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

<section id="metodologia" class="method">
  <div class="container">
    <span class="section-label">Metodología</span>
    <h2 class="section-title">Cómo se hizo</h2>
    <div class="method-grid">
      <div>
        <p>El pipeline extrae reseñas públicas de App Store y Google Play con Apify, las persiste en Supabase con Row-Level Security, y ejecuta dos agentes de Claude en secuencia: el primero clasifica cada reseña (vertical, pain point, sentiment, resumen en español); el segundo agrupa las negativas de la semana en clusters de causa raíz con citas reales.</p>
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
      <div class="method-arch">[Apify scrapers]
       ↓
[Supabase · raw_reviews]
       ↓
[Claude classifier agent]
       ↓
[Supabase · classified_reviews]
       ↓
[Claude weekly clusterer]
       ↓
[Supabase · weekly_briefs]
       ↓
  ┌────┴────┐
  ↓         ↓
Dashboard   Telegram Bot</div>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-row">
      <div>
        <a href="https://github.com/wuirifriskys/voz-del-cliente-rappi-demo" target="_blank" rel="noopener">GitHub</a>
        <a href="https://linkedin.com/in/alex-friedlander-a3766197" target="_blank" rel="noopener">LinkedIn</a>
        <a href="https://t.me/Rappi_demo_bot" target="_blank" rel="noopener">Telegram Bot</a>
      </div>
      <div>Alex Friedlander · 2026</div>
    </div>
    <p class="disclaimer">Demo independiente · no afiliada a Rappi. Basada en reseñas públicas de App Store y Google Play México. El dashboard publica sólo agregados y clusters anonimizados. Si Rappi solicita retirarlo, se apaga el mismo día.</p>
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
  // Severity order for fire drills — surfaces the highest-signal verticals first.
  const DRILL_RANK = ['rappipay', 'courier', 'app', 'food', 'grocery', 'pharmacy', 'other'];

  (async () => {
    try {
      const res = await fetch('/api/briefs');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const briefs = data.briefs || [];
      if (briefs.length === 0) {
        document.getElementById('drill-grid').innerHTML = '<div class="loading">Sin datos aún. El pipeline corre semanalmente.</div>';
        return;
      }
      const latestWeek = briefs[0].week_start;
      const thisWeek = briefs.filter(b => b.week_start === latestWeek);
      renderHeroStats(thisWeek);
      renderDrills(thisWeek);
      renderVerticals(thisWeek);
      renderDeepDives(thisWeek);
    } catch (err) {
      document.getElementById('drill-grid').innerHTML = '<div class="error">Error cargando: ' + escapeHtml(err.message) + '</div>';
    }
  })();

  function renderHeroStats(briefs) {
    const total = briefs.reduce((s, b) => s + b.total_reviews, 0);
    const totalNeg = briefs.reduce((s, b) => s + Math.round(b.total_reviews * b.negative_share), 0);
    const clusters = briefs.reduce((s, b) => s + (b.clusters ? b.clusters.length : 0), 0);
    const negShare = total ? Math.round(totalNeg / total * 100) : 0;
    const stats = [
      { v: total, k: 'Reseñas analizadas' },
      { v: negShare + '%', k: 'Negativas' },
      { v: briefs.length, k: 'Verticales' },
      { v: clusters, k: 'Clusters' },
    ];
    document.getElementById('hero-stats').innerHTML = stats.map(x =>
      '<div class="hero-stat"><div class="hero-stat-value">' + x.v + '</div><div class="hero-stat-label">' + x.k + '</div></div>'
    ).join('');
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
      return '<a href="#deep-' + b.vertical + '" class="v-card">' +
        '<div class="v-name">' + (VERTICAL_LABELS[b.vertical] || b.vertical) + '</div>' +
        '<div class="v-total">' + b.total_reviews + '<small>reseñas</small></div>' +
        '<div class="v-neg-label">' + negPct + '% negativas</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + negPct + '%"></div></div>' +
        '<div class="v-pains">' + pains + '</div>' +
        '<div class="v-link">Ver detalle ↓</div>' +
      '</a>';
    }).join('');
  }

  function renderDeepDives(briefs) {
    document.getElementById('deep-dives').innerHTML = briefs.map(b => {
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
      return '<section class="deep" id="deep-' + b.vertical + '">' +
        '<div class="container">' +
          '<div class="deep-header">' +
            '<h3><span class="grad">' + (VERTICAL_LABELS[b.vertical] || b.vertical) + '</span> · detalle completo</h3>' +
            '<a href="#verticales" class="back">Volver ↑</a>' +
          '</div>' +
          '<div class="deep-meta">' +
            '<div class="meta-item"><span class="meta-k">Reseñas</span><span class="meta-v">' + b.total_reviews + '</span></div>' +
            '<div class="meta-item"><span class="meta-k">Negativas</span><span class="meta-v">' + negPct + '%</span></div>' +
            '<div class="meta-item"><span class="meta-k">Top pain point</span><span class="meta-v">' + escapeHtml(topPainLabel) + '</span></div>' +
            '<div class="meta-item"><span class="meta-k">Semana</span><span class="meta-v">' + escapeHtml(b.week_start) + '</span></div>' +
          '</div>' +
          '<div class="deep-cols">' +
            '<div class="deep-col"><h4>Distribución de pain points</h4>' + painBars + '</div>' +
            '<div class="deep-col"><h4>Clusters de causa raíz</h4>' + clusters + '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
</script>
</body>
</html>`;
}
