# ADR-0029: clip vertical en el cliente y vista previa OG desde la API

- Fecha: 2026-11-23
- Estado: aceptada

## Contexto

M8.5 pide un clip de 15 s hecho en el navegador y una vista previa de enlaces con el estado real, sin dependencias nuevas. Los _scrapers_ no ejecutan JS; los lienzos WebGL solo se leen justo tras dibujar.

## Decisión

Clip: `captureStream` + `MediaRecorder` (mp4 si hay, si no WebM) sobre un lienzo 2D 1080×1920 que compone mapa, deck.gl y un overlay propio; los lienzos WebGL se copian en el evento de render (MapLibre `render`, deck.gl `onAfterRender`), **sin `preserveDrawingBuffer`** (que penalizaría a todos, también en móviles de teselas). Solo el botón va en el JS inicial; el motor es un chunk diferido. OG: `GET /api/v1/share` devuelve HTML con metas y el índice de `computePulse` (texto neutro sin datos), `SHARE_BASE_URL` por configuración (nunca de `Host`), escapado total, caché de 60 s, límites como `/pulse`; imagen estática `og.png` (decisión del humano: sin librería de imagen).

## Consecuencias

El clip cuesta solo mientras se graba. La vista previa con número exige compartir `/api/v1/share` (o una regla de Caddy, propuesta en `docs/deploy.md`). El chunk del clip pesa ~2,1 KB gzip y deja el JS diferido en 560,5 KB: el límite pasa a 565 KB (ADR-0030).
