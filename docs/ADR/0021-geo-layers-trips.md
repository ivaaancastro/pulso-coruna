# ADR-0021: `@deck.gl/geo-layers` 9.4.1 para las estelas de bus (TripsLayer)

- Fecha: 2026-11-19
- Estado: aceptada (pendiente de revisión humana, como toda dependencia nueva)

## Contexto

M4.3 pide estelas por línea con `TripsLayer`, que vive en `@deck.gl/geo-layers` (ADR-0007 fijó solo `core`, `layers` y `maplibre`).

## Decisión

Añadir `@deck.gl/geo-layers` 9.4.1 exacta (misma versión que el resto de deck.gl; verificado con Context7 y `npm view`: peers `~9.4`). Solo se importa `TripsLayer` desde la capa bus, que ya es un chunk diferido; el paquete declara `sideEffects: false`, así que el resto (MVT, H3, 3D Tiles…) no entra en el bundle. Peso medido (gzip): +~3 KB sobre usar `PathLayer` de `@deck.gl/layers` (~3 KB el `TripsLayer` frente a un `PathLayer`; el lockfile crece por las dependencias transitivas de geo-layers, que no se envían al navegador).

## Alternativas

Subclase propia de `PathLayer` con la misma inyección de shader (~50 líneas, sin dependencia ni lockfile mayor, pero mantener shaders GLSL/WGSL propios).

## Consecuencias

Peso total real de la ruta diferida de mapa (mapa + deck.gl + `@deck.gl/layers` + capa bus) ≈ 514 KB gzip, por encima de los 450 KB del presupuesto aunque `check-bundle.mjs` solo cuente 356 KB (el patrón `mapChunkPattern` no recoge los chunks `bus.layer-*`, `debug-hooks-*`, `expression-*`…). La causa principal es `@deck.gl/layers` (≈ +85 KB), no geo-layers. Decisión humana pendiente: ampliar el presupuesto o el patrón del script (ver `docs/specs/M4.3b-capa-bus.md`).
