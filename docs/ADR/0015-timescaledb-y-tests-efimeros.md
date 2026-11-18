# ADR-0015: TimescaleDB 2.32 (PG17) y BD efímera de tests con `docker run`

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

La ingesta usa hypertables, compresión, retención y agregados continuos; los tests de integración necesitan una BD real y desechable que no rompa el CI normal.

## Decisión

Imagen `timescale/timescaledb:2.32.0-pg17` (edición community, con compresión y agregados continuos). Los tests la arrancan con `docker run` (puerto aleatorio, `--rm`) desde un helper propio de ~60 líneas, sin `testcontainers`. Si Docker no está disponible, los tests de integración se saltan; `PULSO_TEST_DATABASE_URL` permite usar una BD existente. `ubuntu-latest` de GitHub trae Docker, así que el CI los ejecuta.

## Alternativas

`testcontainers` (+ módulo postgresql): más completo pero añade dependencias pesadas y un daemon auxiliar (Ryuk) por una necesidad pequeña. PG sin Timescale: no probaría las migraciones reales.

## Consecuencias

Cero dependencias nuevas para tests. Subir de versión de Timescale = cambiar la etiqueta aquí y en el helper.
