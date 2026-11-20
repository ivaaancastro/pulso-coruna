# Roadmap — Pulso A Coruña

Fuente de verdad del plan. Checklist operativa en `docs/TASKS.md`; decisión en `docs/ADR/0004-roadmap-por-hitos.md`.

## Principios

1. **Cortes verticales.** Cada hito termina en algo que se ve y se puede grabar en un vídeo de 15 s. Nada de semanas de backend invisible.
2. **Diseño y rendimiento son puertas de todos los hitos**, no una fase final. Desde M2 el CI mide y falla si se rompe un presupuesto.
3. **Grabar cuanto antes.** Reproducir necesita histórico: la grabadora (M3) se despliega en cuanto hay una fuente verificada, en paralelo al frontend.
4. **Fixtures y simulación primero.** El frontend avanza con datos grabados o simulados (etiquetados) sin esperar a la API ni a permisos.
5. **Menos capas, mejor hechas.** Una capa no entra hasta que se ve y se mueve al nivel de la postal (M2).

## Presupuestos de rendimiento

Medidos con la skill `perf-budget` (móvil de gama media emulado: CPU 4×, red «Fast 4G», 390×844) en local y en un móvil real. En CI (desde M2.5) solo se aplican los que no dependen de GPU: peso de JS, peticiones a terceros y Lighthouse; los runners no tienen GPU (WebGL por software), así que allí los fps solo vigilan regresiones con un umbral propio fijado en el ADR de M2.5.

| Métrica                                                                                | Presupuesto                      |
| -------------------------------------------------------------------------------------- | -------------------------------- |
| Fotogramas con todas las capas activas                                                 | media ≥ 58 fps, p5 ≥ 50 fps      |
| Primer fotograma del mapa (`performance.mark('map:first-frame')`; LCP no ve el canvas) | < 2,0 s                          |
| JS inicial (gzip, sin librería de mapa)                                                | < 250 KB                         |
| Mapa + deck.gl + capas (gzip, diferida)                                                | < 560 KB                         |
| INP (tocar entidad, cambiar modo, arrastrar línea temporal)                            | < 100 ms                         |
| Trabajo en hilo principal por fotograma                                                | < 8 ms (interpolación en worker) |
| Peticiones del navegador a terceros                                                    | 0                                |
| Degradación automática                                                                 | si < 45 fps durante 3 s          |

## Puerta de calidad (al cerrar cada hito)

- [ ] Tests y typecheck en verde; lint y formato limpios.
- [ ] `perf-budget` dentro de presupuesto (desde M2).
- [ ] `design-review` sin defectos bloqueantes (desde M2).
- [ ] Demo de 15 s grabada (`docs/demos/<hito>.md` con enlace; la carpeta se crea en M2).
- [ ] Revisión cruzada (subagente `reviewer` + otro agente) y revisión humana.

## Hitos

### M0 — Cimientos

Repo, CI y herramientas listos.

| ID   | Tarea                             | Criterio de aceptación                                                               |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------ |
| T1.1 | Monorepo y herramientas (hecho)   | pnpm, TS estricto, lint, CI                                                          |
| M0.1 | Roadmap y herramientas de agentes | Este roadmap; MCP fijados; skills `design-review` y `perf-budget`                    |
| M0.2 | `packages/schema` con zod         | Esquemas de Entity, StationStatus, Observation y mensaje WS; tests (contract-change) |

### M1 — Verdad y dirección

Saber qué datos existen de verdad y cómo se va a ver el producto. Fuentes y diseño en paralelo.

| ID   | Tarea                                           | Criterio de aceptación                                                                                     |
| ---- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| M1.1 | Nota GTFS Compañía de Tranvías                  | `docs/sources/gtfs-tranvias.md` (skill `source-note`); GTFS validado                                       |
| M1.2 | Nota iTranvías                                  | Respuesta de ejemplo, frecuencia medida, riesgos; licencia «pendiente de decisión humana»                  |
| M1.3 | Notas BiciCoruña y MeteoGalicia                 | BiciCoruña: ¿disponibilidad en vivo y licencia? MeteoGalicia: estaciones 10157 (sin viento), 14000 y 14003 |
| M1.4 | Notas mar, aire, barcos, aviones                | Portus, Calidade do Aire, aisstream, OpenSky; REData solo como contexto regional                           |
| M1.5 | Permiso iTranvías (humano)                      | Correo enviado; respuesta archivada o plan B decidido                                                      |
| M1.6 | Dirección de arte                               | `docs/design/`: moodboard, paleta nocturna, tipografía, movimiento, intro; aprobada por el humano          |
| M1.7 | ADR de versiones de render                      | MapLibre GL (5 o 6) y deck.gl 9.x fijados tras consultar Context7                                          |
| M1.8 | Datos de tráfico al Concello (humano, opcional) | Solicitud enviada; mientras, congestión estimada con velocidad de buses y etiquetada                       |

**Demo:** frames de referencia (mockups) de la postal y la intro.

### M2 — La postal

A Coruña nocturna en 3D que ya impresiona sin datos en vivo. Fija el listón visual y de rendimiento.

| ID   | Tarea                          | Criterio de aceptación                                                                                                                        |
| ---- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| M2.1 | PMTiles propios de A Coruña    | Script reproducible (OSM → PMTiles), ≤ 15 MB, servido como estático                                                                           |
| M2.2 | Mapa base con estilo propio    | Edificios extruidos, agua y costa protagonistas, luz según la hora real; fiel a `docs/design/`                                                |
| M2.3 | Intro de cámara coreografiada  | Vuelo bahía → península < 4 s, interrumpible, versión estática con `prefers-reduced-motion`                                                   |
| M2.4 | Tokens de diseño y shell de UI | Tokens CSS de `docs/design/`; hora, índice (placeholder), selector de modo; teclado; módulo de cadenas (sin textos fijos)                     |
| M2.5 | CI de rendimiento              | Tamaño de bundle, Lighthouse CI y test de fps con Playwright; falla al superar presupuestos (ADR)                                             |
| M2.6 | PWA instalable                 | Manifest, iconos, service worker con caché de teselas; instalable en Chrome y funciona sin conexión (Lighthouse 12 ya no tiene categoría PWA) |

**Demo:** intro + órbita lenta sobre la ciudad de noche.

### M3 — La grabadora

Datos reales grabándose 24/7 en el VPS. Arranca en paralelo a M2.

| ID   | Tarea                        | Criterio de aceptación                                                                     |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| M3.1 | Adaptador GTFS               | Rutas, paradas y trazados a GeoJSON; tests con fixture (skill `new-adapter`)               |
| M3.2 | Adaptador BiciCoruña         | Estaciones a StationStatus; tests con fixtures                                             |
| M3.3 | Adaptador MeteoGalicia       | Viento de las tres estaciones a Observation; tests                                         |
| M3.4 | Adaptador iTranvías o plan B | Posiciones a Entity con límite de peticiones; o simulación desde GTFS etiquetada «horario» |
| M3.5 | Ingesta + TimescaleDB        | Intervalos, reintentos con espera creciente, `source_health`; tests con BD efímera         |
| M3.6 | Despliegue mínimo            | `docker compose up` en VPS con Caddy y HTTPS; backup diario; documentado                   |

**Demo:** consulta en vivo de `source_health` y primer día completo grabado.

### M4 — El latido

Bus, bici y viento en vivo, con movimiento continuo.

| ID   | Tarea                                | Criterio de aceptación                                                               |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| M4.1 | API snapshot, stream y health        | Cumple el contrato; snapshot al conectar y deltas; límite de conexiones por IP       |
| M4.2 | Cliente WS + interpolación en worker | Reconexión con espera creciente; hilo principal < 8 ms/fotograma                     |
| M4.3 | Capa bus                             | Estelas por línea (TripsLayer), toque: línea, destino, próxima parada                |
| M4.4 | Capa bici                            | Anillos que se llenan y vacían con transición                                        |
| M4.5 | Viento                               | Partículas WebGL propias interpoladas entre estaciones; reducidas con reduced-motion |
| M4.6 | Estados de fuente caída              | Capa atenuada y etiqueta «sin datos desde hace X min»; diseñado, no improvisado      |
| M4.7 | Degradación automática               | < 45 fps durante 3 s reduce partículas y estelas; test                               |

**Demo:** la ciudad respirando en directo durante una hora punta.

### M5 — La marea

Identidad marítima completa.

| ID   | Tarea                                  | Criterio de aceptación                                                         |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------ |
| M5.1 | Adaptadores mar, aire, barcos, aviones | Cuatro tareas paralelas (worktrees), fixtures y tests; claves solo en servidor |
| M5.2 | Capas web                              | Marea, barcos orientados, halos de aire, trazas de aviones                     |
| M5.3 | Tarjetas de detalle                    | Panel al tocar con diseño común para todas las capas                           |

**Demo:** un barco entrando en el puerto con la marea subiendo.

### M6 — Máquina del tiempo

| ID   | Tarea            | Criterio de aceptación                                             |
| ---- | ---------------- | ------------------------------------------------------------------ |
| M6.1 | Retención        | Brutos 30 días, después 1 muestra/min/entidad; test sintético      |
| M6.2 | `/api/v1/replay` | Ventanas de 5 min en MessagePack; precarga de la siguiente ventana |
| M6.3 | Línea temporal   | Selector de día, 1×/60×/600×, arrastre fluido a 60 fps             |
| M6.4 | URL compartible  | Restaura cámara, capas, hora y modo                                |

**Demo:** un día entero en 2 min 24 s a 600× (24 h ÷ 600 = 144 s; con 1×/60×/600× no hay una velocidad más rápida).

### M7 — Escuchar y Pulso

| ID   | Tarea           | Criterio de aceptación                                                              |
| ---- | --------------- | ----------------------------------------------------------------------------------- |
| M7.1 | Motor Web Audio | Pentatónica, cuantización, ≤ 16 voces, carga diferida, apagado por defecto          |
| M7.2 | Índice Pulso    | Cálculo, `/api/v1/pulse`, pesos en configuración, perfil fijo hasta un mes de datos |
| M7.3 | Visualización   | Número grande con animación sobria y serie del día                                  |

**Demo:** la misma escena con sonido.

### M8 — Pulido y lanzamiento

| ID   | Tarea                      | Criterio de aceptación                                                      |
| ---- | -------------------------- | --------------------------------------------------------------------------- |
| M8.1 | Idiomas gl/es/en           | Ninguna cadena fija en el código; gallego por defecto si se pide            |
| M8.2 | Accesibilidad              | Teclado completo, paleta apta para daltonismo, reduced-motion, contraste AA |
| M8.3 | Móvil real antiguo         | Presupuestos cumplidos en un dispositivo físico; resultados documentados    |
| M8.4 | Estado y créditos          | Página de estado de fuentes y atribuciones requeridas                       |
| M8.5 | Clip vertical y OG         | Clip de 15 s generado en el cliente; imagen OG con el estado real           |
| M8.6 | README, GIF y post técnico | Números reales de rendimiento y coste                                       |
| M8.7 | Contacto institucional     | Humano: Concello y Compañía de Tranvías antes de la salida                  |
| M8.8 | Salida por pasos           | Cerrado → local → global                                                    |

### v2 — Después

Tren de Media Distancia, comparar días, API pública documentada, app iOS + widget (solo si la PWA no basta).

## Paralelismo

- M0.2 ∥ M1.1–M1.4 ∥ M1.6 (diseño no depende de datos).
- M2 (frontend con fixtures) ∥ M3 (backend grabando).
- M5.1: cuatro worktrees, un adaptador cada uno.

## Lo que decide el humano

Licencias y términos de cada fuente, contacto con terceros, dirección de arte final (paleta, tipografía, sonido), publicación.
