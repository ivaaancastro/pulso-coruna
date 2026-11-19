# apps/api

API de lectura de Pulso (`@pulso/api`, Fastify). Lee de TimescaleDB lo que graba `apps/ingest` y lo sirve según el contrato de `packages/schema`. Spec: `docs/specs/M4.1-api-snapshot-stream.md`.

- `GET /api/v1/snapshot?layers=bus,bike` · `WS /api/v1/stream` · `GET /api/v1/health` · `GET /api/v1/replay?from=&to=&layers=` (MessagePack, M6.2, `docs/specs/M6.2-api-replay.md`)
- Desarrollo: `DATABASE_URL=… pnpm --filter @pulso/api build && DATABASE_URL=… pnpm --filter @pulso/api start` (la ingesta crea las tablas).
- Tests: `pnpm --filter @pulso/api test` (los de BD arrancan TimescaleDB con Docker; `PULSO_TEST_DB=skip` los salta).
- Configuración por variables de entorno: `.env.example` y `src/config.ts`. Despliegue: `docs/deploy.md`.
