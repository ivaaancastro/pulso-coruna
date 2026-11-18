# ADR-0007: versiones de render (MapLibre GL y deck.gl)

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

Hay que fijar mapa y capas antes de M2. Context7 dio «Invalid API key»; se verificó con `npm view`/`npm pack` (sin leer docs web: WebFetch falló), así que la integración se apoya en el conocimiento de la API, no en doc consultada.

## Decisión

`maplibre-gl` 5.24.1 (rama 5, exacta) y `deck.gl` 9.4.1: `@deck.gl/core`, `layers` y `mapbox` 9.4.1 exactas, sin el paquete paraguas. `@deck.gl/mapbox` no declara peer de maplibre-gl (solo `core`/`luma.gl` ~9.4), compatible. Integración: `MapboxOverlay` con `interleaved: false` (canvas propio, aislado del estilo); `interleaved: true` solo si M2 exige oclusión con edificios 3D. Peso gzip: maplibre 5.24.1 = 276 KB medidos (`dist/maplibre-gl.js`); deck.gl sin medir (estimado 100–150 KB tree-shaken), total estimado ~380–430 KB frente a < 450 KB: margen estrecho, se medirá en M2 con `perf-budget`.

## Alternativas

MapLibre 6.19.0 (publicada hace 1 día; `maplibre-gl.mjs` 298 KB + worker 157 KB = ~455 KB gzip, por sí sola rompe el presupuesto). deck.gl 9.3.x (sin motivo).

## Consecuencias

Añadir las dependencias exige PR propia con este ADR; migrar a MapLibre 6 requerirá nuevo ADR y medir peso.
