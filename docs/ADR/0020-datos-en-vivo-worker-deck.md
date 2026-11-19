# ADR-0020: datos en vivo del frontend (worker, deck.gl y dependencias)

- Fecha: 2026-11-19
- Estado: aceptada

## Contexto

M4.2 necesita cliente WebSocket, interpolación fuera del hilo principal y deck.gl sobre MapLibre. ADR-0007 fijó versiones y la integración; aquí se añaden las dependencias.

## Decisión

- `@deck.gl/core`, `@deck.gl/layers` y `@deck.gl/maplibre` 9.4.1 exactas (ADR-0007), verificadas con Context7 y `npm view` (peers `@luma.gl/*` ~9.4 los instala pnpm). `MapLibreOverlay`, `interleaved: false`. Entran solo por `src/live/deck.ts` (chunk diferido, import dinámico, y solo si hay capas registradas).
- `@pulso/schema` (workspace) como dependencia de `apps/web`: el worker valida con `WsMessageSchema`. zod queda en el chunk del worker (~29 KB gzip), no en el JS inicial.
- WebSocket, validación, almacén e interpolación viven en un Web Worker (`live.worker.ts`); el hilo principal recibe buffers `Float32Array` transferidos. Sin nuevas dependencias para el mock de desarrollo: plugin de Vite propio (`apply: "serve"`, `PULSO_MOCK_LIVE=1`) con handshake WebSocket mínimo.
- Capas: descubrimiento con `import.meta.glob("./layers/*.layer.ts")` (sin fichero compartido que editar). En producción el stream solo se activa con `VITE_LIVE_URL`; en desarrollo usa `/api/v1/stream`.

## Alternativas

`ws` para el mock (dependencia extra); WebSocket en el hilo principal y solo interpolación en worker (parseo y zod en el hilo principal).

## Consecuencias

Peso medido: mapa + deck.gl (core, MapLibreOverlay, webgl-device) 420 KB gzip frente a 450: queda poco margen para `@deck.gl/layers` y las capas (vigilar en M4.3–M4.5). `perf-budget.json` incluye ahora `webgl-device` en el patrón del chunk de mapa.
