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

- [x] M3.1 Adaptador GTFS
- [x] M3.2 Adaptador BiciCoruña
- [x] M3.3 Adaptador MeteoGalicia
- [x] M3.4 Adaptador iTranvías o plan B
- [x] M3.5 Ingesta + TimescaleDB + `source_health`
- [x] M3.6 Despliegue mínimo en VPS

## M4 — El latido

- [x] M4.1 API snapshot, stream, health
- [x] M4.2 Cliente WS + interpolación en worker
- [x] M4.3 Capa bus
  - [x] M4.3a Estimador de buses por horario
  - [x] M4.3b Capa bus (estelas, color por línea, tarjeta)
- [x] M4.4 Capa bici
- [x] M4.5 Viento con partículas
- [x] M4.6 Estados de fuente caída
- [x] M4.7 Degradación automática

## M5 — La marea

- [x] M5.1 Adaptadores mar, aire, barcos, aviones
  - [x] M5.1c Adaptador de barcos (aisstream; fixtures sintéticas, validar con tráfico real)
  - [x] M5.1d Adaptador aviones (OpenSky)
  - [x] M5.1a Adaptador mar (Portus, nivel del mar)
  - [x] M5.1b aire (Open-Meteo/CAMS, modelo)
- [ ] M5.2 Capas web
  - [x] M5.2a Capa de marea (halo de nivel, tendencia, tarjeta; ver `docs/specs/M5.2a-capa-marea.md`)
  - [x] M5.2c Capa de aire: halo de modelo con etiqueta «modelo» y tarjeta (`docs/specs/M5.2c-capa-aire.md`)
  - [x] M5.2d Capa aviones (silueta, traza y posición estimada por extrapolación)
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

### Estado de la puerta M2

- [x] Código M2.1–M2.7 en `develop`; CI (`check`, `perf`) verde.
- [x] `perf-budget` y `design-review` pasados por los agentes en emulación; sin medir en móvil real.
- [x] Demo de 15 s grabada (`docs/demos/M2.mp4`, toma funcional con WebGL por software; regrabar en móvil real para portfolio).
- [x] Esquina oscura de la intro comprobada en móvil emulado: ya no aparece.
- [x] Revisión humana final y visto bueno (2026-11-18). **M2 cerrado.**
