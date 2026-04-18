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
- Si menciona app no carga, errores, crashes → app/app_bug
- Si menciona tarjeta, pago fallido → rappipay/payment_failure
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

  // Pull reviews that haven't been classified yet
  const { data: pending, error } = await supabase
    .from("raw_reviews")
    .select("id, text")
    .not("id", "in", `(select review_id from classified_reviews)`)
    .limit(MAX_REVIEWS_PER_RUN);

  if (error) throw new Error(`[classifier] fetch failed: ${error.message}`);
  if (!pending || pending.length === 0) {
    console.log("[classifier] nothing to classify");
    return { processed: 0, skipped: 0 };
  }

  console.log(`[classifier] ${pending.length} reviews pending`);

  let processed = 0;
  let skipped = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE) as ClassifyItem[];
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
      const { error: upsertErr } = await supabase
        .from("classified_reviews")
        .upsert(rows, { onConflict: "review_id" });
      if (upsertErr) throw new Error(upsertErr.message);
      processed += rows.length;
      console.log(`[classifier] batch ${i / BATCH_SIZE + 1}: +${rows.length}`);
    } catch (err) {
      skipped += batch.length;
      console.error(`[classifier] batch ${i / BATCH_SIZE + 1} failed:`, err);
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
