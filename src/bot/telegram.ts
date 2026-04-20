// Telegram bot webhook handler. Handles /digest and /vertical commands.
// Called from the Cloudflare Worker's /telegram/<secret> endpoint.
//
// Uses HTML parse mode (not Markdown) because the content comes from LLM-generated
// cluster themes and user review quotes that can contain asterisks, underscores,
// or backticks which silently break Markdown parsing and produce empty replies.

import { createClient } from "@supabase/supabase-js";
import type { WeeklyBrief } from "../lib/types.ts";
import type { Env } from "../worker.ts";
import { computeTrends, type VerticalTrend } from "../lib/trends.ts";

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

const VERTICAL_LABELS: Record<string, string> = {
  food: "Food",
  grocery: "Grocery",
  pharmacy: "Pharmacy",
  rappipay: "RappiPay",
  courier: "Courier",
  app: "App",
  other: "Other",
};

const PAIN_LABELS: Record<string, string> = {
  late_delivery: "Entrega tardía",
  missing_item: "Falta producto",
  wrong_item: "Producto incorrecto",
  app_bug: "Error de app",
  payment_failure: "Fallo de pago",
  support_unresponsive: "Soporte no responde",
  courier_behavior: "Comportamiento del repartidor",
  price_complaint: "Queja de precio",
  other: "Otro",
};

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message || !message.text || !env.TELEGRAM_BOT_TOKEN) return;

  const text = message.text.trim();
  const chatId = message.chat.id;

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await reply(env.TELEGRAM_BOT_TOKEN, chatId, HELP_TEXT);
    return;
  }
  if (text.startsWith("/digest")) {
    await reply(env.TELEGRAM_BOT_TOKEN, chatId, await digestMessage(env));
    return;
  }
  if (text.startsWith("/trend")) {
    await reply(env.TELEGRAM_BOT_TOKEN, chatId, await trendMessage(env));
    return;
  }
  if (text.startsWith("/vertical")) {
    const arg = text.replace(/^\/vertical(@\w+)?\s*/, "").trim().toLowerCase();
    await reply(env.TELEGRAM_BOT_TOKEN, chatId, await verticalMessage(env, arg));
    return;
  }
  await reply(env.TELEGRAM_BOT_TOKEN, chatId, HELP_TEXT);
}

const HELP_TEXT = `<b>Voz del Cliente — Rappi MX</b>

Comandos disponibles:
• /digest — top 5 fire drills de la semana
• /trend — qué se está moviendo (share negativa por vertical, últimas 6 semanas)
• /vertical &lt;nombre&gt; — detalle por vertical (food, grocery, pharmacy, rappipay, courier, app)
• /help — este mensaje

Demo independiente, no afiliada a Rappi. Basada en reseñas públicas de Google Play México (Android).`;

async function digestMessage(env: Env): Promise<string> {
  const briefs = await fetchLatestBriefs(env);
  if (briefs.length === 0) return "Sin datos aún. El pipeline corre semanalmente.";

  // Data-driven Fire Drill ranking: same formula as the dashboard
  // (negative_share × log(total_reviews + 1)). Hide small-N (<25 reviews) verticals.
  const topVerticals = briefs
    .filter((b) => b.vertical !== "other" && b.total_reviews >= 25)
    .map((b) => ({
      vertical: b.vertical,
      label: VERTICAL_LABELS[b.vertical] ?? b.vertical,
      share: b.negative_share,
      total: b.total_reviews,
      score: b.negative_share * Math.log(b.total_reviews + 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const week = briefs[0].week_start;
  const lines = [
    `<b>Voz del Cliente — semana ${esc(week)}</b>`,
    "",
    ...topVerticals.map(
      (t) => `• <b>${esc(t.label)}</b> · ${t.total} reseñas · ${Math.round(t.share * 100)}% negativas`,
    ),
    "",
    "Usa /trend para ver movimientos 6 semanas · /vertical &lt;nombre&gt; para el detalle.",
  ];
  return lines.join("\n");
}

async function trendMessage(env: Env): Promise<string> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return "Trend no disponible (service role key no configurada).";
  }
  const trends = await computeTrends(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const usable = trends.filter(
    (t) => t.weeks.length >= 4 && t.weeks.some((w) => w.total_reviews >= 20),
  );
  if (usable.length === 0) return "No hay volumen suficiente para calcular tendencia todavía.";

  const movers = usable
    .map((t) => {
      const first = t.weeks[0];
      const last = t.weeks[t.weeks.length - 1];
      const delta = (last.negative_share - first.negative_share) * 100;
      return { vertical: t.vertical, first, last, delta, nWeeks: t.weeks.length };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const lines: string[] = [];
  lines.push(`<b>Tendencia — últimas 6 semanas</b>`);
  lines.push("");
  for (const m of movers) {
    const label = VERTICAL_LABELS[m.vertical] ?? m.vertical;
    const arrow = m.delta > 2 ? "↑" : m.delta < -2 ? "↓" : "→";
    const tag = m.delta > 2 ? "Empeora" : m.delta < -2 ? "Mejora" : "Estable";
    const deltaStr = `${m.delta >= 0 ? "+" : ""}${Math.round(m.delta)}pp`;
    const fromPct = Math.round(m.first.negative_share * 100);
    const toPct = Math.round(m.last.negative_share * 100);
    lines.push(
      `${arrow} <b>${esc(label)}</b> · ${tag} · ${fromPct}% → ${toPct}% (${deltaStr}) · ${m.nWeeks - 1} semanas`,
    );
  }
  lines.push("");
  lines.push("Δ = primera vs última semana del histórico disponible.");
  return lines.join("\n");
}

function verticalTrendFooter(trends: VerticalTrend[], vertical: string): string | null {
  const t = trends.find((x) => x.vertical === vertical);
  if (!t || t.weeks.length < 2) return null;
  const first = t.weeks[0];
  const last = t.weeks[t.weeks.length - 1];
  const delta = (last.negative_share - first.negative_share) * 100;
  const fromPct = Math.round(first.negative_share * 100);
  const toPct = Math.round(last.negative_share * 100);
  const deltaStr = `${delta >= 0 ? "+" : ""}${Math.round(delta)}pp`;
  const tag = delta > 2 ? "↑ empeora" : delta < -2 ? "↓ mejora" : "→ estable";
  return `Δ ${t.weeks.length - 1} sem: ${fromPct}% → ${toPct}% (${deltaStr}, ${tag})`;
}

async function verticalMessage(env: Env, vertical: string): Promise<string> {
  if (!vertical) {
    return "Uso: /vertical &lt;nombre&gt;\n\nOpciones: food, grocery, pharmacy, rappipay, courier, app, other";
  }
  const briefs = await fetchLatestBriefs(env);
  const brief = briefs.find((b) => b.vertical === vertical);
  if (!brief) {
    const available = briefs.map((b) => b.vertical).join(", ");
    return `No hay brief para "<b>${esc(vertical)}</b>" esta semana.\n\nVerticales disponibles: ${esc(available)}`;
  }

  const label = VERTICAL_LABELS[brief.vertical] ?? brief.vertical;
  const lines: string[] = [];
  lines.push(`<b>${esc(label)} — semana ${esc(brief.week_start)}</b>`);
  lines.push(`Reseñas: ${brief.total_reviews} · Negativas: ${Math.round(brief.negative_share * 100)}%`);

  // Trend footer (Feature B): show Δ vs the oldest week in the 6-week history
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const trends = await computeTrends(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      const footer = verticalTrendFooter(trends, brief.vertical);
      if (footer) lines.push(footer);
    } catch {
      // trend is best-effort; vertical reply should still succeed without it
    }
  }

  lines.push("");
  lines.push("<b>Top pain points:</b>");
  for (const p of brief.top_pain_points) {
    const label = PAIN_LABELS[p.pain_point] ?? p.pain_point;
    lines.push(`• ${esc(label)} · ${p.count} (${Math.round(p.share * 100)}%)`);
  }
  lines.push("");
  lines.push("<b>Clusters:</b>");
  for (const c of brief.clusters.slice(0, 5)) {
    lines.push(`• <b>${esc(c.theme)}</b> (~${c.count})`);
    if (c.example_quote) {
      lines.push(`  <i>"${esc(c.example_quote)}"</i>`);
    }
  }
  return lines.join("\n");
}

async function fetchLatestBriefs(env: Env): Promise<WeeklyBrief[]> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data, error } = await supabase
    .from("weekly_briefs")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const latest = (data ?? [])[0]?.week_start;
  return (data ?? []).filter((b) => b.week_start === latest) as WeeklyBrief[];
}

async function reply(token: string, chatId: number, text: string): Promise<void> {
  // Telegram caps messages at 4096 characters. Truncate with a soft ellipsis
  // so we never fail silently due to length.
  const safe = text.length > 4000 ? text.slice(0, 4000) + "\n\n…" : text;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: safe,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[telegram] sendMessage failed ${res.status}: ${body}`);
    // Fallback: resend as plain text (no parse_mode) so the user sees something.
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: stripHtml(safe),
        disable_web_page_preview: true,
      }),
    });
  }
}

// Escape text for Telegram HTML parse mode. Only these three chars matter.
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
