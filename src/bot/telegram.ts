// Telegram bot webhook handler. Handles /digest and /vertical commands.
// Called from the Cloudflare Worker's /telegram/<secret> endpoint.
//
// Uses HTML parse mode (not Markdown) because the content comes from LLM-generated
// cluster themes and user review quotes that can contain asterisks, underscores,
// or backticks which silently break Markdown parsing and produce empty replies.

import { createClient } from "@supabase/supabase-js";
import type { WeeklyBrief } from "../lib/types.ts";
import type { Env } from "../worker.ts";

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
• /vertical &lt;nombre&gt; — detalle por vertical (food, grocery, pharmacy, rappipay, courier, app)
• /help — este mensaje

Demo independiente, no afiliada a Rappi. Basada en reseñas públicas de App Store y Google Play.`;

async function digestMessage(env: Env): Promise<string> {
  const briefs = await fetchLatestBriefs(env);
  if (briefs.length === 0) return "Sin datos aún. El pipeline corre semanalmente.";

  const topVerticals = briefs
    .filter((b) => b.vertical !== "other")
    .map((b) => ({
      vertical: b.vertical,
      label: VERTICAL_LABELS[b.vertical] ?? b.vertical,
      share: b.negative_share,
      total: b.total_reviews,
    }))
    .sort((a, b) => b.share * b.total - a.share * a.total)
    .slice(0, 5);

  const week = briefs[0].week_start;
  const lines = [
    `<b>Voz del Cliente — semana ${esc(week)}</b>`,
    "",
    ...topVerticals.map(
      (t) => `• <b>${esc(t.label)}</b> · ${t.total} reseñas · ${Math.round(t.share * 100)}% negativas`,
    ),
    "",
    "Usa /vertical &lt;nombre&gt; para ver el detalle.",
  ];
  return lines.join("\n");
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
  lines.push("");
  lines.push("<b>Top pain points:</b>");
  for (const p of brief.top_pain_points) {
    const label = PAIN_LABELS[p.pain_point] ?? p.pain_point;
    lines.push(`• ${esc(label)} · ${p.count} (${Math.round(p.share * 100)}%)`);
  }
  lines.push("");
  lines.push("<b>Clusters:</b>");
  for (const c of brief.clusters.slice(0, 5)) {
    lines.push(`• <b>${esc(c.theme)}</b> (${c.count})`);
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
