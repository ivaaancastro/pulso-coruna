# Pulso A Coruña — Especificación

> Fuente de verdad: este repo. Roadmap y presupuestos en `docs/ROADMAP.md`; dirección de arte en `docs/design/`.
> Versión extendida (diagramas, tablas de fuentes, plan de lanzamiento) en el doc online: https://claude.ai/artifact/NADta5KrKPrP8Uq2GJCAga. Si discrepa, manda el repo.

## Resumen

Web 3D en tiempo real de A Coruña como organismo vivo. Tres modos: En vivo, Reproducir (24 h, 1x/60x/600x), Escuchar (sonificación Web Audio, apagado por defecto). Índice Pulso 0–100 = media ponderada de actividad por capa vs. lo habitual a esa hora/día (perfil fijo hasta tener un mes de histórico; pesos en configuración).
Fuera de alcance: cuentas, monetización, publicidad, planificador de rutas, datos personales.

## Metas

Producto premium que destaque por diseño y rendimiento. Presupuestos completos en `docs/ROADMAP.md` (fps, primer fotograma del mapa, peso de JS, INP, cero peticiones a terceros), medidos con la skill `perf-budget` y, lo que no depende de GPU, en CI desde M2.5. Además: datos < 60 s de retraso; coste < 10 €/mes; README con GIF y despliegue con un comando.

## Capas y fuentes

Bus (GTFS + iTranvías, riesgo legal) · Bici (SOFIA, por confirmar) · Meteo (MeteoGalicia) · Aire (Calidade do Aire) · Mar (Portus, por confirmar) · Barcos (aisstream.io) · Aviones (OpenSky) · Tren (v2). Sin datos abiertos: tráfico, ruido, energía municipal → estimar congestión con velocidad de buses (etiquetada como estimación).

## Arquitectura

Adaptadores → ingesta → PostgreSQL/TimescaleDB → API Fastify (REST + WS) → caché Cloudflare → web estática. El navegador nunca habla con fuentes externas.

## Contratos

Esquemas zod y tipos (`z.infer`) en `packages/schema/src/` (`layers`, `entity`, `station`, `observation`, `ws`, `replay`; ADR-0006). Validación estricta: rangos geográficos, `ts` entero epoch ms UTC > 1e11 (los segundos se rechazan), números finitos, claves desconocidas rechazadas. Capa→tipo: `bus|ship|plane|train`→Entity, `bike`→StationStatus, `weather|air|sea`→Observation; snapshot y delta validan que cada elemento corresponda a su capa. Identidad: Entity y StationStatus por `id`; Observation por `stationId:metric` (`observationKey`; los `removes` de observaciones usan esa clave). Mensajes WS versionados (`v:1`) como unión discriminada por `type`: `snapshot {v,type,ts,layers:{<layer>:items[]}}` y `delta {v,type,ts,layer,upserts[],removes[]}`. El cliente usa `v` para compatibilidad: cualquier campo nuevo o cambio incompatible sube `v`. Endpoints:

- `GET /api/v1/snapshot?layers=bus,bike`
- `WS /api/v1/stream` (snapshot al conectar, luego deltas `{v:1,type:"delta",ts,layer,upserts[],removes[]}`)
- `GET /api/v1/replay?from=&to=&layers=` (ventana ≤ 5 min, `application/msgpack`; `ReplayWindowSchema` `v:1` columnar con estado inicial, `resolution: "raw"|"1m"`; `docs/specs/M6.2-api-replay.md`)
- `GET /api/v1/health`
- `GET /api/v1/pulse?from=&to=`

Tablas: `positions`, `station_status`, `observations` (hipertablas por `ts`), `source_health`. Retención: 30 días brutos, luego 1 muestra/min/entidad.

## Reglas

Cambios incompatibles → `v2`. Tiempos UTC epoch ms. Nada de datos personales (de BiciCoruña solo estaciones).

## Visual

Dirección cinematográfica nocturna (brief en `docs/design/README.md`): el mar como protagonista, solo brilla lo que es dato, cámara con intro coreografiada, poco texto y muy cuidado. MapLibre + PMTiles propios, edificios extruidos de OSM, deck.gl (TripsLayer, ScatterplotLayer, IconLayer, HeatmapLayer), viento con partículas WebGL propias, interpolación entre mensajes. `prefers-reduced-motion` respetado.

## Riesgos principales

API de iTranvías no oficial (pedir permiso, caché en servidor, plan B con posiciones simuladas desde GTFS etiquetadas como horario); fuentes que fallan (capas que se atenúan); licencias (nota por fuente y créditos visibles).
