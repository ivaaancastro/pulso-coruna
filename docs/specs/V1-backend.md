# V1 simple: backend

**Objetivo**: la v1 solo muestra el directo. Lo que sirve al histórico se apaga por configuración, sin borrar código ni migraciones.

**API** (`apps/api`): `API_FEATURES` (lista separada por comas; `replay`, `pulse`, `share`; vacía por defecto). `buildApp` monta cada ruta solo si su flag está activo; sin flag, 404 normal de Fastify. Nombre desconocido: `loadConfig` lanza. Snapshot, stream y `/health` no cambian (`/health` no menciona replay/pulse/share).

**Ingesta** (`apps/ingest`): `INGEST_RETENTION_ENABLED` (por defecto `false`; sustituye a `RETENTION_ENABLED`). Apagado no se crea el pool dedicado ni se llama a `startRetention`. Los seeds sintéticos son scripts manuales y no se arrancan.

**Migraciones**: 0002/0003 (agregados `*_1m`, `retention_status`) se siguen aplicando para no divergir de BD ya desplegadas; quedan sin uso en la v1.

**Volver al histórico**: `API_FEATURES=replay,pulse,share` + `INGEST_RETENTION_ENABLED=true`.

**Tests**: `testConfig` activa los tres flags; hay tests de 404 sin flag y de que snapshot/stream/health no cambian; test de config de `API_FEATURES` e `INGEST_RETENTION_ENABLED`.
