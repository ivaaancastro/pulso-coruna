# ADR-0024: MessagePack con `@msgpack/msgpack` para `/api/v1/replay`

- Fecha: 2026-11-19
- Estado: aceptada

## Contexto

`GET /api/v1/replay` (M6.2) sirve ventanas de 5 min en MessagePack (SPEC). La API codifica y, en M6.3, la web decodificará: el bundle del cliente paga la librería.

## Decisión

`@msgpack/msgpack` 3.1.3 (exacta; Context7: `encode`/`decode` sin configuración). Solo `apps/api` ahora; `apps/web` la añadirá en M6.3 importando únicamente `decode`. Medido con esbuild (minify, browser): `decode` solo = 13,8 KB / **4,2 KB gzip** (<5 KB) → no merece un decodificador propio. Contrato `v:1` columnar con enteros cuantizados (`packages/schema`, `docs/specs/M6.2-api-replay.md`), que ya reduce el cuerpo frente a JSON.

## Alternativas

Decodificador propio mínimo (~1 KB): ahorra ~3 KB pero hay que mantenerlo y testearlo. JSON + gzip: sin dependencia, pero 3–4× más grande antes de comprimir y más lento de parsear. `msgpackr`: más rápido, más grande (~10 KB gzip).

## Consecuencias

+4,2 KB gzip diferidos en la web cuando se active Reproducir (cargar con import dinámico; presupuesto en ADR-0021). Subir de versión mayor exige revisar `encode`/`decode` y los tests de round-trip.
