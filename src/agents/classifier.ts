// Claude classifier agent. Reads unclassified rows from raw_reviews, batches them,
// sends to Claude with a structured-output prompt, writes to classified_reviews.
//
// Run: `bun src/agents/classifier.ts`

import { anthropic, CLASSIFIER_MODEL } from "../lib/anthropic.ts";
import { serverClient } from "../lib/supabase.ts";
import type { ClassifiedReview, PainPoint, RawReview, Vertical } from "../lib/types.ts";

const BATCH_SIZE = 50; // reviews per Claude call
const MAX_REVIEWS_PER_RUN = 10_000;

const VERTICALS: Vertical[] = ["food", "grocery", "pharmacy", "rappipay", "courier", "app", "other"];
const PAIN_POINTS: PainPoint[] = [
  "late_delivery",
  "missing_item",
  "wrong_item",
  "app_bug",
  "payment_failure",
  "support_unresponsive",
  "courier_behavior",
  "price_complaint",
  "other",
];

const SYSTEM_PROMPT = `Eres un analista senior de Voz del Cliente (Voice of Customer) para Rappi México.
Clasificas reseñas públicas de tienda de apps. Por cada reseña devuelve:

- vertical: uno de ${JSON.stringify(VERTICALS)}
- pain_point: uno de ${JSON.stringify(PAIN_POINTS)} (o "other" si no hay queja clara o es positiva)
- sentiment: 1-5 (1 = muy negativo, 5 = muy positivo)
- summary_es: 1 frase en español (máx 120 caracteres) que resuma lo esencial

Reglas:
- Si la reseña es positiva, pain_point="other" y sentiment>=4
- Si menciona repartidor o entrega tardía → courier/late_delivery
- Si menciona producto incorrecto o faltante → grocery/food/pharmacy según contexto + missing_item/wrong_item
- Si menciona que la app no carga, errores, crashes, UI, login, búsqueda → app/app_bug
- Si menciona tarjeta, pago fallido → rappipay/payment_failure
- Usa vertical="app" SOLO cuando la queja principal es la aplicación móvil en sí
  (crashes, UI, cuenta, búsqueda, login). Si el texto menciona "la app" pero la queja
  real es entrega tardía / producto faltante / soporte / cobro → asigna el vertical
  correspondiente (courier/food/grocery/rappipay), NO "app"
- Español correcto con acentos (á, é, í, ó, ú, ñ)
- NUNCA inventes detalles que no están en el texto`;

interface ClassifyItem {
  id: string;
  text: string;
}

interface ClassifyResult {
  id: string;
  vertical: Vertical;
  pain_point: PainPoint;
  sentiment: number;
  summary_es: string;
}

export async function runClassifier(): Promise<{ processed: number; skipped: number }> {
  const supabase = serverClient();
  const claude = anthropic();

  // Fetch already-classified UUIDs so we can skip duplicates from parallel scrapers
  // (same review can arrive with different id prefixes: gp:, gpe:, gpx:).
  const { data: existingClassified, error: cErr } = await supabase
    .from("classified_reviews")
    .select("review_id");
  if (cErr) throw new Error(`[classifier] fetch classified failed: ${cErr.message}`);
  const uuidOf = (id: string) => id.split(":")[1] ?? id;
  const classifiedUuids = new Set((existingClassified ?? []).map((c) => uuidOf(c.review_id)));

  // Pull reviews that haven't been classified yet. PostgREST caps rows at 1000
  // per request, so page through explicitly.
  const pendingAll: Array<{ id: string; text: string }> = [];
  for (let page = 0; page < 20; page++) {
    const { data, error: pErr } = await supabase
      .from("raw_reviews")
      .select("id, text")
      .not("id", "in", `(select review_id from classified_reviews)`)
      .range(page * 1000, page * 1000 + 999);
    if (pErr) throw new Error(`[classifier] fetch page ${page} failed: ${pErr.message}`);
    if (!data || data.length === 0) break;
    pendingAll.push(...data);
    if (data.length < 1000) break;
  }
  const pending = pendingAll.slice(0, MAX_REVIEWS_PER_RUN);

  if (pending.length === 0) {
    console.log("[classifier] nothing to classify");
    return { processed: 0, skipped: 0 };
  }

  // Dedup by UUID: prefer gp: > gpe: > gpx: (current scraper first). Also drop any
  // pending row whose UUID has already been classified under a different prefix.
  const prefixRank: Record<string, number> = { gp: 0, gpe: 1, gpx: 2 };
  const sorted = (pending as ClassifyItem[]).slice().sort((a, b) => {
    const ra = prefixRank[a.id.split(":")[0]] ?? 9;
    const rb = prefixRank[b.id.split(":")[0]] ?? 9;
    return ra - rb;
  });
  const pickedByUuid = new Map<string, ClassifyItem>();
  let droppedAlreadyClassified = 0;
  let droppedInBatch = 0;
  for (const row of sorted) {
    const uuid = uuidOf(row.id);
    if (classifiedUuids.has(uuid)) {
      droppedAlreadyClassified++;
      continue;
    }
    if (pickedByUuid.has(uuid)) {
      droppedInBatch++;
      continue;
    }
    pickedByUuid.set(uuid, row);
  }
  const deduped = Array.from(pickedByUuid.values());
  console.log(
    `[classifier] ${pending.length} pending → ${deduped.length} after dedup ` +
      `(dropped ${droppedAlreadyClassified} already-classified UUIDs, ${droppedInBatch} in-batch dupes)`,
  );

  let processed = 0;
  let skipped = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyBatch(claude, batch);
      const rows: ClassifiedReview[] = results.map((r) => ({
        review_id: r.id,
        vertical: r.vertical,
        pain_point: r.pain_point,
        sentiment: r.sentiment,
        summary_es: r.summary_es,
        classified_at: new Date().toISOString(),
      }));
      // Only upsert rows whose review_id actually matches a pending id (guard against
      // hallucinated ids that would FK-violate).
      const pendingIds = new Set(batch.map((b) => b.id));
      const safeRows = rows.filter((r) => pendingIds.has(r.review_id));
      const { error: upsertErr } = await supabase
        .from("classified_reviews")
        .upsert(safeRows, { onConflict: "review_id" });
      if (upsertErr) throw new Error(upsertErr.message);
      processed += safeRows.length;
      const dropped = rows.length - safeRows.length;
      console.log(`[classifier] batch ${i / BATCH_SIZE + 1}: +${safeRows.length}${dropped ? ` (dropped ${dropped} unmatched ids)` : ""}`);
    } catch (err) {
      skipped += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[classifier] batch ${i / BATCH_SIZE + 1} failed: ${msg.slice(0, 200)}`);
    }
  }

  return { processed, skipped };
}

async function classifyBatch(claude: ReturnType<typeof anthropic>, items: ClassifyItem[]): Promise<ClassifyResult[]> {
  const userPrompt = `Clasifica estas ${items.length} reseñas. Devuelve SOLO un array JSON válido, sin texto adicional:

${items.map((it, idx) => `[${idx}] id="${it.id}" | text="""${sanitize(it.text)}"""`).join("\n")}

Formato de respuesta (array JSON, un objeto por reseña, en el mismo orden):
[{"id": "...", "vertical": "...", "pain_point": "...", "sentiment": N, "summary_es": "..."}]`;

  const response = await claude.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("no text response from Claude");
  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("no JSON array in response");

  const parsed = JSON.parse(jsonMatch[0]) as ClassifyResult[];
  return parsed.filter((r) => VERTICALS.includes(r.vertical) && PAIN_POINTS.includes(r.pain_point));
}

function sanitize(text: string): string {
  return text.replace(/"""/g, '"\'"\'"\'').slice(0, 500);
}

if (import.meta.main) {
  runClassifier()
    .then((r) => {
      console.log("[classifier] done:", r);
    })
    .catch((err) => {
      console.error("[classifier] fatal:", err);
      process.exit(1);
    });
}
