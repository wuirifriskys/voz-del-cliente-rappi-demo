// Telegram bot webhook handler. Handles /digest and /vertical commands.
// Called from the Cloudflare Worker's /telegram/<secret> endpoint.

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

const HELP_TEXT = `*Voz del Cliente — Rappi MX*

Comandos disponibles:
• /digest — top 5 fire drills de la semana
• /vertical <nombre> — deep dive (food, grocery, pharmacy, rappipay, courier, app)

Demo independiente, no afiliada a Rappi. Basada en reseñas públicas de App Store y Google Play.`;

async function digestMessage(env: Env): Promise<string> {
  const briefs = await fetchLatestBriefs(env);
  if (briefs.length === 0) return "Sin datos aún. El pipeline corre semanalmente.";

  const topVerticals = briefs
    .map((b) => ({ vertical: b.vertical, share: b.negative_share, total: b.total_reviews }))
    .sort((a, b) => b.share * b.total - a.share * a.total)
    .slice(0, 5);

  const week = briefs[0].week_start;
  let out = `*Voz del Cliente — semana ${week}*\n\n`;
  for (const t of topVerticals) {
    out += `• *${t.vertical}* · ${t.total} reseñas · ${Math.round(t.share * 100)}% negativas\n`;
  }
  out += `\nUsa /vertical <nombre> para deep dive.`;
  return out;
}

async function verticalMessage(env: Env, vertical: string): Promise<string> {
  if (!vertical) return "Uso: /vertical <nombre> (food | grocery | pharmacy | rappipay | courier | app)";
  const briefs = await fetchLatestBriefs(env);
  const brief = briefs.find((b) => b.vertical === vertical);
  if (!brief) return `No hay brief para "${vertical}" esta semana.`;

  let out = `*${brief.vertical} — semana ${brief.week_start}*\n`;
  out += `Reseñas: ${brief.total_reviews} · Negativas: ${Math.round(brief.negative_share * 100)}%\n\n`;
  out += `*Top pain points:*\n`;
  for (const p of brief.top_pain_points) {
    out += `• ${p.pain_point} · ${p.count} (${Math.round(p.share * 100)}%)\n`;
  }
  out += `\n*Clusters:*\n`;
  for (const c of brief.clusters.slice(0, 3)) {
    out += `• *${c.theme}* (${c.count})\n`;
    if (c.example_quote) out += `  _"${c.example_quote}"_\n`;
  }
  return out;
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
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  });
}
