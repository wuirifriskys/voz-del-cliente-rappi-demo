# Voz del Cliente — Rappi MX

> Demo independiente construida para la vacante **Rappi AI Builder** (Ciudad de México). No afiliada a Rappi. Basada en reseñas públicas de Google Play México (Android).

## Alcance y limitaciones conocidas

- **Solo Android / Google Play MX.** La extracción de App Store está implementada (`src/scrapers/app-store.ts`) pero desactivada por flag: los endpoints públicos de Apple (RSS + actores Apify probados: easyapi, benthepythondev, jdtpnjtp, andok, websift) retornan cero reseñas para Rappi MX. Se re-activa con `APP_STORE_ENABLED=1` el día que encontremos un actor que funcione.
- **Ventana de brief = 7 días reales.** El brief semanal se genera sobre las reseñas publicadas en los últimos 7 días del momento de la corrida. El dashboard también muestra una **serie histórica de 6 semanas ISO** (endpoint `/api/trends`) calculada a partir del corpus clasificado completo — permite ver regresiones y mejoras semana a semana.
- **Deduplicación por UUID.** Los scrapers en paralelo pueden producir 2+ filas por la misma reseña; el clasificador mantiene una sola clasificación por UUID.
- **Verificación de citas.** Cada `example_quote` de cluster se verifica contra el texto real antes de persistirse; si no coincide (verbatim o normalizado), se descarta el cluster.
- **Denominador de pain points.** Los porcentajes de pain points se calculan sobre reseñas con queja específica (excluye positivas/vagas) para mantener el denominador accionable. La share negativa usa el total.
- **Taxonomía fija (9 pain points).** Cubre ~75% de quejas accionables; gaps conocidos: cobertura/disponibilidad de zona, cancelación de suscripciones, account/login, publicidad engañosa. v2 los añade.
- **Sin eval de ground truth.** La exactitud de clasificación es directional (~80% vertical, ~95% sentiment sobre muestras manuales), no medida formalmente. Próximo paso: etiquetar ~300 reseñas y reportar F1 por vertical.

Un agente que ingesta las reseñas públicas de Rappi México, las clasifica por vertical y causa raíz con Claude, agrupa patrones en clusters semanales, y los sirve por dashboard público + bot de Telegram.

## ¿Por qué existe?

La oferta dice: *"Valoramos el trabajo demostrado por encima de los currículums tradicionales."*

Entonces en lugar de mandar solo CV, construí un agente sobre la operación real de Rappi en México. 3–4 horas de build. Stack que el AI Squad usa: LLM APIs, agentes, automatización end-to-end.

## Arquitectura

```
[Apify Google Play]─┐
                    ├─→ Supabase.raw_reviews ─→ Claude classifier ─→ Supabase.classified_reviews
[Apify App Store ]─┘                                                           │
                                                                               ↓
                                                        Claude weekly clusterer
                                                                               │
                                                                               ↓
                                                          Supabase.weekly_briefs
                                                                               │
                                                 ┌─────────────────────────────┴──┐
                                                 ↓                                ↓
                                Cloudflare Worker dashboard          Telegram bot (/digest, /vertical)
```

## Qué clasifica

**Verticales:** food · grocery · pharmacy · rappipay · courier · app · other
**Pain points:** late_delivery · missing_item · wrong_item · app_bug · payment_failure · support_unresponsive · courier_behavior · price_complaint · other
**Sentiment:** 1–5
**Resumen:** 1 frase en español por reseña

Cada semana, un segundo agente agrupa las reseñas negativas de cada vertical en 3–5 clusters accionables ("Faltan medicamentos en Polanco", no "problemas de inventario") con una cita real de ejemplo.

## Links en vivo

- Dashboard: https://voz-del-cliente-rappi-demo.alexfriedlanderpascual.workers.dev
- API briefs: https://voz-del-cliente-rappi-demo.alexfriedlanderpascual.workers.dev/api/briefs
- Bot de Telegram: ver /digest — configurar webhook con el token propio
- Código: este repo (https://github.com/wuirifriskys/voz-del-cliente-rappi-demo)

## Estructura

```
src/
  lib/          — clientes Anthropic/Supabase + tipos compartidos
  scrapers/     — Apify runners (Google Play + App Store)
  agents/       — classifier.ts + clusterer.ts
  bot/          — handler Telegram
  worker.ts     — Cloudflare Worker (dashboard + webhook)
sql/
  schema.sql    — tablas + RLS
scripts/
  security-audit.sh — gate anti-secretos antes de push
```

## Seguridad

Repo público → cero secretos en código o historial de git.

- **Anthropic / Supabase service role / Telegram token:** sólo como `wrangler secret put`
- **Supabase anon key:** público por diseño, gated por RLS (sólo lectura de `weekly_briefs`)
- `.env` nunca se commitea; `.env.example` tiene placeholders
- `scripts/security-audit.sh` se corre pre-push: grep de prefijos conocidos (`sk-ant-`, `eyJ`, `apify_api_`) + gitleaks si está instalado
- Tabla `raw_reviews` tiene RLS activo sin policies para anon → inaccesible desde el cliente público

## Correr en local

```bash
cp .env.example .env              # rellená con tus valores (nunca commitear)
bun install
# 1. Crear proyecto Supabase, correr sql/schema.sql en el SQL Editor
# 2. Scrape
bun run scrape
# 3. Classify
bun run classify
# 4. Cluster
bun run cluster
# 5. Dashboard local
bun run dev
```

## Deploy (Cloudflare Worker)

```bash
# Cargar secretos (una vez)
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Variables públicas en wrangler.toml (SUPABASE_URL, SUPABASE_ANON_KEY)
wrangler deploy

# Registrar webhook en Telegram
curl -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://<your-worker>.workers.dev/telegram/<webhook-secret>"
```

## Disclaimer

Proyecto independiente. Los datos provienen de reseñas públicas de App Store y Google Play. El dashboard y el bot publican sólo agregados y clusters anonimizados; nunca texto raw con usernames. Si alguien de Rappi quiere que baje el demo, lo apago el mismo día.

## Licencia

MIT
