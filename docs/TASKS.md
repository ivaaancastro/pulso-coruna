# Tareas (resumen; detalle y criterios en docs/SPEC.md y en el doc online)

## Fase 0 — verificación (semana 0) [humano + agente]
- T0.1 Registro en NAP y descarga GTFS → `docs/sources/gtfs-tranvias.md`
- T0.2 Pedir permiso a Compañía de Tranvías para datos de iTranvías (humano)
- T0.3 Verificar resto de fuentes: BiciCoruña (¿disponibilidad en vivo?), calidad del aire, Portus, aisstream, OpenSky → una nota por fuente
- T0.4 Solicitar al Concello datos de tráfico (opcional)

## Fase 1 — MVP (semanas 1–2)
- T1.1 Monorepo y herramientas (pnpm, TS estricto, lint, CI)
- T1.2 `packages/schema` con validación (zod) y tests
- T1.3 Adaptador GTFS (rutas, paradas, trazados → GeoJSON)
- T1.4 Adaptador iTranvías (posiciones → Entity; límite de peticiones)
- T1.5 Adaptador BiciCoruña (→ StationStatus)
- T1.6 Adaptador MeteoGalicia (viento → Observation)
- T1.7 Servicio de ingesta + TimescaleDB + `source_health`
- T1.8 API: `/api/v1/snapshot`, `WS /api/v1/stream`, `/api/v1/health`
- T1.9 Web: mapa base 3D (MapLibre + PMTiles, edificios extruidos, luz según hora)
- T1.10 Web: capas bus, bici y viento a 60 fps
- T1.11 Despliegue: docker compose + Caddy + HTTPS

## Fase 2 — v1 (semanas 3–6)
T2.1 adaptadores mar/aire/barcos/aviones · T2.2 capas web · T2.3 retención (30 d brutos, luego 1/min) ·
T2.4 Reproducir (`/api/v1/replay`) · T2.5 Escuchar (Web Audio, escala pentatónica, máx. 16 voces) ·
T2.6 Índice Pulso (`/api/v1/pulse`) · T2.7 URL compartible + clip vertical 15 s · T2.8 i18n gl/es/en ·
T2.9 página de estado y créditos · T2.10 accesibilidad y rendimiento

## Fase 3 — lanzamiento (semanas 7–8)
T3.1 vídeo/GIF/OG · T3.2 README y docs · T3.3 post técnico · T3.4 contacto institucional · T3.5 salida por pasos (cerrado → local → global)

## Fase 4 — v2
Tren Media Distancia, comparar días, API pública, app iOS + widget (decidir tras ver si la PWA basta).

## Puertas de calidad
No empezar una fase sin cumplir la anterior (ver spec).
