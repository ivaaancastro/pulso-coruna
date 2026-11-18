# ADR-0015: driver `postgres` para la ingesta

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

`apps/ingest` (y luego la API) necesitan hablar con PostgreSQL/TimescaleDB: inserciones por lotes, upserts, transacciones y migraciones.

## Decisión

`postgres` (porsager) 4.1.1 exacta. Sin dependencias, ESM nativo, tipos propios, tagged templates parametrizados (sin inyección) y `sql(rows, ...cols)` para inserts por lotes. Fijada tras comprobar la versión en npm (Context7 no disponible).

## Alternativas

`pg` (node-postgres): más extendido pero sin tipos propios y con API de callbacks/params posicionales más verbosa. ORMs (Drizzle, Prisma): peso y abstracción innecesarios para SQL con funciones de Timescale.

## Consecuencias

Una dependencia de runtime (más `@types/node` fijado exacto como devDependency de `apps/ingest`, para los tipos de `node:*`). Las migraciones son SQL plano propio (sin librería de migraciones).
