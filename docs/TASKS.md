# Tareas

Checklist operativa. Detalle, criterios y presupuestos en `docs/ROADMAP.md`. Una tarea = una rama = una PR (`<tipo>/<ID>-<slug>`).

## M0 — Cimientos

- [x] T1.1 Monorepo y herramientas
- [x] M0.1 Roadmap y herramientas de agentes
- [x] M0.2 `packages/schema` con zod y tests

## M1 — Verdad y dirección

- [x] M1.1 Nota GTFS Compañía de Tranvías
- [x] M1.2 Nota iTranvías
- [x] M1.3 Notas BiciCoruña y MeteoGalicia
- [x] M1.4 Notas mar, aire, barcos, aviones
- [x] M1.5 Permiso iTranvías (humano; decisión: usar la API tal cual)
- [x] M1.6 Dirección de arte (aprobada por el humano)
- [x] M1.7 ADR de versiones MapLibre / deck.gl
- [x] M1.8 Datos de tráfico al Concello (humano, opcional; decisión: usar los datos o API que proporcionan)

## M2 — La postal

- [x] M2.1 PMTiles propios
- [x] M2.2 Mapa base con estilo propio
- [x] M2.3 Intro de cámara
- [x] M2.4 Tokens de diseño y shell de UI
- [x] M2.5 CI de rendimiento
- [x] M2.6 PWA instalable
- [x] M2.7 Alturas reales de edificios (plantas del Catastro, ADR-0013)

## M3 — La grabadora

- [ ] M3.1 Adaptador GTFS
- [ ] M3.2 Adaptador BiciCoruña
- [ ] M3.3 Adaptador MeteoGalicia
- [ ] M3.4 Adaptador iTranvías o plan B
- [ ] M3.5 Ingesta + TimescaleDB + `source_health`
- [ ] M3.6 Despliegue mínimo en VPS

## M4 — El latido

- [ ] M4.1 API snapshot, stream, health
- [ ] M4.2 Cliente WS + interpolación en worker
- [ ] M4.3 Capa bus
- [ ] M4.4 Capa bici
- [ ] M4.5 Viento con partículas
- [ ] M4.6 Estados de fuente caída
- [ ] M4.7 Degradación automática

## M5 — La marea

- [ ] M5.1 Adaptadores mar, aire, barcos, aviones
- [ ] M5.2 Capas web
- [ ] M5.3 Tarjetas de detalle

## M6 — Máquina del tiempo

- [ ] M6.1 Retención
- [ ] M6.2 `/api/v1/replay`
- [ ] M6.3 Línea temporal
- [ ] M6.4 URL compartible

## M7 — Escuchar y Pulso

- [ ] M7.1 Motor Web Audio
- [ ] M7.2 Índice Pulso
- [ ] M7.3 Visualización del índice

## M8 — Pulido y lanzamiento

- [ ] M8.1 Idiomas gl/es/en
- [ ] M8.2 Accesibilidad
- [ ] M8.3 Móvil real antiguo
- [ ] M8.4 Estado y créditos
- [ ] M8.5 Clip vertical y OG
- [ ] M8.6 README, GIF y post técnico
- [ ] M8.7 Contacto institucional (humano)
- [ ] M8.8 Salida por pasos

## Puertas de calidad

No se cierra un hito sin su puerta (ver `docs/ROADMAP.md`).
