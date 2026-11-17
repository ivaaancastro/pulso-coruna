# Pulso A Coruña — Especificación

> Versión completa (con diagramas de arquitectura y roadmap, tablas de fuentes y criterios de cada tarea) en el doc online:
> https://claude.ai/artifact/NADta5KrKPrP8Uq2GJCAga
> Pendiente: pegar aquí el export completo en Markdown (menú Export del doc) para que los agentes lo lean en local.

## Resumen
Web 3D en tiempo real de A Coruña como organismo vivo. Tres modos: En vivo, Reproducir (24 h, 1x/60x/600x), Escuchar (sonificación Web Audio, apagado por defecto). Índice Pulso 0–100 = media ponderada de actividad por capa vs. lo habitual a esa hora/día (perfil fijo hasta tener un mes de histórico; pesos en configuración).
Fuera de alcance: cuentas, monetización, publicidad, planificador de rutas, datos personales.

## Metas
60 fps en móvil de gama media; primera pintura útil < 2,5 s; datos < 60 s de retraso; coste < 10 €/mes; README con GIF y despliegue con un comando.

## Capas y fuentes
Bus (GTFS + iTranvías, riesgo legal) · Bici (SOFIA, por confirmar) · Meteo (MeteoGalicia) · Aire (Calidade do Aire) · Mar (Portus, por confirmar) · Barcos (aisstream.io) · Aviones (OpenSky) · Tren (v2). Sin datos abiertos: tráfico, ruido, energía municipal → estimar congestión con velocidad de buses (etiquetada como estimación).

## Arquitectura
Adaptadores → ingesta → PostgreSQL/TimescaleDB → API Fastify (REST + WS) → caché Cloudflare → web estática. El navegador nunca habla con fuentes externas.

## Contratos
Tipos en `packages/schema/src/index.ts`. Endpoints:
- `GET /api/v1/snapshot?layers=bus,bike`
- `WS /api/v1/stream` (snapshot al conectar, luego deltas `{v:1,type:"delta",ts,layer,upserts[],removes[]}`)
- `GET /api/v1/replay?from=&to=&layers=` (ventanas 5 min, MessagePack)
- `GET /api/v1/health`
- `GET /api/v1/pulse?from=&to=`

Tablas: `positions`, `station_status`, `observations` (hipertablas por `ts`), `source_health`. Retención: 30 días brutos, luego 1 muestra/min/entidad.

## Reglas
Cambios incompatibles → `v2`. Tiempos UTC epoch ms. Nada de datos personales (de BiciCoruña solo estaciones).

## Visual
Ciudad nocturna vista desde arriba. MapLibre + PMTiles propios, edificios extruidos de OSM, deck.gl (TripsLayer, ScatterplotLayer, IconLayer, HeatmapLayer), viento con partículas WebGL propias, interpolación entre mensajes. `prefers-reduced-motion` respetado.

## Riesgos principales
API de iTranvías no oficial (pedir permiso, caché en servidor, plan B con posiciones simuladas desde GTFS etiquetadas como horario); fuentes que fallan (capas que se atenúan); licencias (nota por fuente y créditos visibles).
