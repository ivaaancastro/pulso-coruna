# ADR-0011: CI de rendimiento

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

Desde M2 el CI debe fallar si se rompe un presupuesto (`docs/ROADMAP.md`). Los runners no tienen GPU.

## Decisión

Job `perf` en `ci.yml`, ejecutable en local con `pnpm perf`. devDependencies de la raíz, sin `^`: `@playwright/test` 1.65.1 (fps y 0 terceros sobre el Chrome estable instalado, sin descargar navegador), `@lhci/cli` 0.16.1 (rendimiento ≥ 0,6 y TBT ≤ 5000 ms solo como aviso (varía 2600–5200 ms entre ejecuciones con la intro y WebGL por software, no es fiable como puerta; con el mapa y WebGL por software en el runner salen 0,71 y ~2600 ms: umbral de regresión, no el presupuesto real, que se mide con `perf-budget` en local), accesibilidad y buenas prácticas ≥ 0,95, mediana de 3 ejecuciones; sin PWA), `tslib` 2.9.1 (Lighthouse no lo declara y pnpm estricto falla). Bundle: script Node propio (`apps/web/perf/check-bundle.mjs`), gzip de `dist/` contra `apps/web/perf-budget.json` (JS inicial < 250 KB; chunk `map-*`/`maplibre-*`/`deck-*` < 450 KB, omitido si no existe). Fps en CI (SwiftShader, 390×844, sin CPU throttle): media ≥ 20 y p5 ≥ 10, aprox. un tercio de lo medido sobre el shell (39–57 fps); con mapa, además `map:first-frame` < 6 s. Son umbrales de regresión, no el presupuesto real (58/50, con `PERF_FPS_PROFILE=gpu` en un equipo con GPU) y se recalibran al medir el mapa (M2.2). 0 terceros: cualquier request a otro origen falla.

## Alternativas

Playwright con Chromium propio (descarga ~150 MB por ejecución); bundlesize/size-limit (dependencia para ~100 líneas); Lighthouse vía MCP chrome-devtools (no corre en CI).

## Consecuencias

El chunk de mapa debe llamarse `map-*`, `maplibre-*` o `deck-*` (o ajustar `mapChunkPattern`). `perf` debe añadirse como check obligatorio en la protección de `develop` (decisión humana). No se sube nada a servicios externos (`upload.target: filesystem`).
