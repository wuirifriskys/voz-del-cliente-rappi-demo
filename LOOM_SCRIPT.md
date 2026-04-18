# Loom script — 2 minutos, español

**Instrucciones técnicas:**
- Grabar con cámara abajo-derecha (cara visible)
- Compartir pantalla
- Duración objetivo: 1:45 – 2:15
- Grabar en español, tono directo y sin marketing-speak
- Al final, dejar 2 segundos en la pantalla del dashboard mostrando datos

---

## Guion

**[0:00-0:15] Hook + identidad**

> "Hola equipo Rappi. Soy Alex Friedlander. Vi la vacante de AI Builder y en lugar de solo mandar el CV, construí un agente sobre la operación real de Rappi México. Les voy a mostrar qué hace en dos minutos."

*(Compartir pantalla, abrir el dashboard)*

---

**[0:15-0:45] El dashboard — qué ven**

> "Esto es el dashboard. Scrapié cien reseñas públicas de Rappi en Google Play con Apify, las pasé por un clasificador de Claude que las etiqueta por vertical y pain point, y un segundo agente las agrupa en clusters de causa raíz cada semana."

*(Mover mouse por las 5 cards: food, courier, rappipay, app, other)*

> "Cada vertical tiene su propia card: total de reseñas, porcentaje de negativas, top pain points, y los clusters accionables en español."

---

**[0:45-1:30] El hallazgo — esto es lo que les interesa**

*(Hacer zoom en la card de RappiPay)*

> "Miren esto. De las trece reseñas que caen en la vertical RappiPay en este dataset, el cien por ciento son negativas, y el setenta y siete por ciento son fallos de pago. El cluster top dice: *cobros no autorizados de RappiPro y suscripciones sin consentimiento*. Ese patrón aparece en múltiples reseñas de usuarios distintos. Es el tipo de señal que escala rápido si no se atiende."

*(Moverse a Courier)*

> "En Courier, treinta y ocho reseñas, todas negativas. El sesenta y ocho por ciento mencionan entrega tardía. Cluster top: *pedidos llegan de una a ocho horas después de lo prometido*. Citas reales, anonimizadas, sacadas del texto original."

---

**[1:30-1:50] El stack — qué usé**

> "El stack es exactamente el que pide la vacante: Apify para scraping, Supabase con Row-Level Security para datos, Claude como LLM vía API, Cloudflare Workers para el deploy, y un bot de Telegram que pueden consultar con /digest. Tres, cuatro horas de build. Cero secretos en el repo público: todo vive como wrangler secret."

---

**[1:50-2:05] Cierre**

> "Todo está corriendo en vivo: dashboard, API, bot. Los links están en el mensaje. Si les interesa que prenda clusters con más data o que construya algo parecido para otra vertical, encantado de profundizar. Gracias."

*(Última pantalla: dashboard visible durante 2 segundos)*

---

## Checklist pre-grabación

- [ ] Dashboard cargado en incógnito (sin cache, confirmación de que funciona para cualquiera)
- [ ] Telegram abierto en segundo monitor con /digest ya enviado
- [ ] Sonido claro, sin eco
- [ ] Ninguna notificación de sistema visible
- [ ] Voz en español sin tecnicismos de más
- [ ] Si se equivoca, reintenta — no ediciones post

## Qué NO mencionar

- Que es la primera vez usando estas tools (Apify, Supabase) → se asume dominio
- Pedir feedback o mostrar inseguridad
- Hablar del CV o sesión de Claude (el demo habla por sí solo)
- Decir "quiero aprender" → decir "puedo construir"

## Después de grabar

1. Subir a Loom, poner título: *"Voz del Cliente — Rappi MX | Alex Friedlander"*
2. Link en el mensaje de aplicación
3. Visibilidad: *cualquiera con el link*, no pública listada
