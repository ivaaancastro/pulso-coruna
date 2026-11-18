# @pulso/ingest

Ingesta: ejecuta los adaptadores (`Adapter<T>`) cada `intervalMs`, valida con `@pulso/schema`, guarda en PostgreSQL + TimescaleDB y mantiene `source_health`. Spec: `docs/specs/M3.5-ingesta-timescaledb.md`.

- Adaptadores reales: se cablean solo en `src/registry.ts`.
- Config: variables de entorno (ver `.env.example`): `DATABASE_URL`, `INGEST_TIMEOUT_MS`, `INGEST_MAX_ATTEMPTS`, `INGEST_BACKOFF_BASE_MS`, `INGEST_BACKOFF_MAX_MS`, `INGEST_DOWN_AFTER`.
- Migraciones SQL versionadas en `migrations/` (`NNNN_nombre.sql`), aplicadas al arrancar y de forma idempotente.
- Tests: `pnpm --filter @pulso/ingest test`. Los de integración usan un TimescaleDB efímero en Docker y se saltan solos si no hay Docker (`PULSO_TEST_DB=skip` fuerza saltarlos; `PULSO_TEST_DATABASE_URL` usa una BD ya existente).
