# ADR-0017: ingesta empaquetada con esbuild (imagen sin node_modules)

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

`@pulso/schema` y `@pulso/adapters` apuntan a `src/*.ts`. Node no carga TypeScript desde `node_modules` (type stripping desactivado allí), así que `pnpm deploy` + `node` no arrancaría.

## Decisión

`esbuild` 0.28.2 exacta (devDependency de `apps/ingest`) genera un único `dist/main.js` (ESM, target node22) con todo dentro. La imagen final es `node:22-alpine` + ese fichero + `migrations/` (ruta por `INGEST_MIGRATIONS_DIR`), sin `node_modules`, usuario `node`. `pnpm-workspace.yaml`: `esbuild: false` en `allowBuilds` (el binario viene de un paquete opcional, no hace falta su postinstall).

## Alternativas

`tsx` o `--experimental-strip-types`: dependencia/arranque en runtime, y strip-types falla en `node_modules`. `tsc` por paquete: obliga a cambiar `main` de todos los paquetes.

## Consecuencias

Imagen pequeña y reproducible (lockfile congelado). Los paquetes del workspace no necesitan paso de build propio. Sin sourcemaps de momento.
