# M6 — Puerta de hito (modo Reproducir contra la API real)

- Estado: verificada con datos **sintéticos**; pendiente validación con datos reales y móvil real
- Rama: `chore/M6-puerta`
- Referencia: `docs/ROADMAP.md` M6, `docs/specs/M6.1-retencion.md` … `M6.4-url-compartible.md`, ADR-0024, ADR-0025

## Objetivo

Comprobar de punta a punta que Reproducir funciona contra una pila **real** (TimescaleDB 2.32/PG17 en Docker + `apps/api` + web de Vite) y no solo contra el mock del plugin de Vite: día, 1×/60×/600×, arrastre, enlace compartido, cruce del corte `raw`/`1m` y vuelta a «Ahora». Arreglar lo pequeño, anotar lo grande.

## Cómo repetirlo

```bash
sh apps/ingest/scripts/dev-db.sh                                   # TimescaleDB en 127.0.0.1:55432 (efímera)
export DATABASE_URL=postgres://pulso:pulso@127.0.0.1:55432/pulso
pnpm --filter @pulso/ingest seed:synthetic --hours 60 [--follow]   # migra, siembra, agrega a 1m, retención
pnpm --filter @pulso/api build && API_HOST=127.0.0.1 node apps/api/dist/main.js
VITE_LIVE_URL=ws://127.0.0.1:3000/api/v1/stream pnpm --filter @pulso/web exec vite --host 127.0.0.1 --port 5190
node apps/web/perf/puerta-m6.mjs --shots                           # PERF_FPS_PROFILE=gpu para GPU real
sh apps/ingest/scripts/dev-db.sh stop
```

- **Datos** (`apps/ingest/scripts/synthetic.ts`, función pura del instante; ids `syn-…`, `meta.synthetic = 1`; sin red externa): 16 buses en 4 líneas (servicio 05–23 UTC, de noche no hay), 4 barcos (3 con ciclo entrada–atraque–salida de 3 h y uno fondeado), 2 aviones (12 min cada hora), 16 estaciones de bici, 3 estaciones de viento y marea (5 min), aire modelado (1 h). Ticks de 15 s. El script se niega a sembrar una BD que no sea local (`SEED_ALLOW_REMOTE=1` lo fuerza).
- **Corte `raw`/`1m`**: además de las horas recientes, siembra ±3 h alrededor de `ahora − 30 d` y ejecuta `runRetention` (refresca `*_1m`), de modo que esa franja se lee de las vistas y el resto de los brutos. Con `RETENTION_RAW_DAYS` distinto, exportarlo también al sembrar.
- **Medidas**: `apps/web/perf/puerta-m6.mjs` (Playwright + Chrome estable, headless; lee `window.__pulsoReplay`, que solo existe en `vite` dev). No forma parte de `pnpm perf`: necesita la pila levantada. La caché de la API es «inmutable» y fija la resolución de cada ventana, así que **conviene reiniciar la API entre pasadas** para que lo «en frío» lo sea.

## Resultados

Pila: macOS arm64, Chrome estable headless, API y BD en la misma máquina (latencia de red ≈ 0). 24 h de datos de ayer (+ hoy hasta ahora), ≈ 270 000 filas de posiciones (60 h + franja del corte).

### Qué se probó (y pasó)

| Prueba                                                                                | Resultado                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrar en Reproducir (390×844 y 1440×900), mapa y capas con datos reales de la API    | Bien. Hora de la barra = instante; capturas `docs/design/capturas/puerta-m6-*.png`.                                                             |
| Elegir «ayer» y saltar a las 11:00                                                    | Bien (`resolution: raw`, sin «sin datos»).                                                                                                      |
| 1× (4 s) y 60× (4 s)                                                                  | Avanzan 4,0 s y 240,1 s (esperado 4 s y 240 s).                                                                                                 |
| 600× en frío (8 s)                                                                    | Avanza ≈ 79,9 min simulados en 8,05 s (≈ 595×); 23–24 peticiones, todas 200; sin cargas visibles.                                               |
| Arrastre del cursor (ida y vuelta sobre el día, 5 s)                                  | Bien; vuelve a pintar sin «cargando» persistente.                                                                                               |
| Enlace `#v=1&c=…&m=r&t=…&s=60` en pestaña nueva                                       | Entra en Reproducir, instante y velocidad correctos, en pausa; hash estable. Pide solo las ventanas del instante (y su vecina y la anterior).   |
| Cruce del corte (arrancando 6 min antes a 600×)                                       | La barra dice `1m` («Datos antiguos: una muestra por minuto.») y pasa a `raw` al cruzar, sin huecos, errores ni `loading`.                      |
| Volver a «Ahora»                                                                      | Barra oculta, reloj grande en hora real, directo al día.                                                                                        |
| Consola                                                                               | Sin errores ni `pageerror`. Solo avisos de deck.gl (`Attribute instanceColors is normalized`) y, con GL por software, `GPU stall … ReadPixels`. |
| 429 (12 ventanas nuevas a la vez desde una IP, directo a la API)                      | 2 × 200 y 10 × 429 con `Retry-After: 2` (diseño: `API_REPLAY_MAX_GLOBAL = 2`). El navegador, con sus ≤ 3 peticiones, no recibió ninguno.        |
| 413 (API con `API_REPLAY_MAX_BYTES=9000`, ventana de 12 KB)                           | 413 → el cliente pide por capa y fusiona; 21 × 200 y 3 × 413, datos en pantalla.                                                                |
| 503 (API con BD inalcanzable)                                                         | 503 + `Retry-After: 5`; la barra queda en «Cargando datos…» mientras reintenta (3 intentos, ≈ 10 s) y no inventa datos.                         |
| ETag/304 y `Cache-Control` (`max-age=86400, immutable` en ventanas pasadas alineadas) | Bien.                                                                                                                                           |

### Números

fps medidos con `requestAnimationFrame` (8 s a 600× en frío; 5 s de arrastre):

| Perfil                                           | Viewport | 600× media / p5 / máx. fotograma | Arrastre media / p5 / máx. fotograma |
| ------------------------------------------------ | -------- | -------------------------------- | ------------------------------------ |
| GPU real (`PERF_FPS_PROFILE=gpu`, Apple, Metal)  | 1440×900 | 60,0 / 59,9 / 16,8 ms            | 60,0 / 59,5 / 16,8 ms                |
| GPU real                                         | 390×844  | 60,0 / 59,9 / 16,8 ms            | 60,0 / 59,5 / 16,8 ms                |
| GL por software (SwiftShader, como `ci` de perf) | 1440×900 | 56,1 / 15,0 / 550 ms             | 34,5 / 2,2 / 467 ms                  |
| GL por software                                  | 390×844  | 21,6 / 8,6 / 467 ms              | 19,8 / 3,5 / 300 ms                  |

Con GPU se cumple el presupuesto de M6.3 (arrastre a 60 fps). Con SwiftShader (sin GPU) el arrastre cae: cada salto de horas recalcula el estado de todas las capas y la luz del mapa, y el render por software no lo absorbe. Es la misma limitación que el perfil `ci` de `perf-budget.json` (solo vigila regresiones, `avgMin` 20 / `p5Min` 10) y no es representativa de un teléfono, pero **el arrastre en móviles modestos queda sin validar** (ver pendientes).

Peticiones y API (datos locales, latencia de red ≈ 0):

- 600× en frío: 23–24 peticiones en ≈ 8 s ⇒ media **2,98 req/s**, pico **9–10 req/s** en el primer segundo (ventana actual + precarga de hasta 8), 3 simultáneas como máximo. Ninguna 429/503/413. En régimen necesita 2 ventanas/s (600× ÷ 300 s).
- Tamaño de ventana (7 capas, ≈ 22 móviles + 16 estaciones + series): media **≈ 11 KB**, máx. 13,2 KB (`raw`); `1m`: 2,5–7,5 KB (sin `meta`).
- Latencia de la API vista desde el navegador: p50 4–11 ms, p95 15–21 ms, máx. 33–78 ms. Directo a la API, 20 ventanas en frío en serie: p50 4–5 ms, p95 70–115 ms (la primera lectura de cada tabla); caliente (caché de memoria): p50 0,4 ms.
- Holgura frente a `API_REPLAY_MAX_GLOBAL = 2`: con 2 lecturas simultáneas y una ventana de 600× cada 0,5 s, la API aguanta hasta ≈ 1 s de latencia por lectura antes de que el reloj se pare en `loading`. Con la BD local sobra (≈ 10 ms); con datos de 30 días y un VPS pequeño, hay que medirlo.

## Cambios hechos en la puerta

1. **«Ver» → «Ahora»** (es), «Now» (en, antes «Watch»), «Agora» (gl) (`i18n/*.ts`; el id interno sigue siendo `view`). Tests y textos de spec actualizados.
2. **ROADMAP**: la demo de M6 («un día entero en 15 s a 600×») es imposible: 24 h ÷ 600 = 144 s. Ahora dice «un día entero en 2 min 24 s a 600×». Sin velocidades nuevas.
3. **Petición de más al abrir un enlace** (`main.ts`, `replay/controller.ts`): `modes.select("replay")` llamaba a `enter()` (que coloca el cursor una hora antes de «ahora» y arranca el worker con ese instante) y solo después `applyState` saltaba al del enlace; la primera ventana pedida era inútil y consumía una de las 2 lecturas globales de la API. Ahora `restoreReplay` deja el estado pendiente y la entrada se hace con `applyState`, que coloca día e instante **antes** de `enter()`; el mensaje `init` al worker ya lleva el instante del enlace. Test: `controller.test.ts` («abrir con un instante pedido…»). Verificado en el navegador: las ventanas pedidas al abrir el enlace son la del instante, la siguiente y la anterior.
4. Herramientas reproducibles: `apps/ingest/scripts/{synthetic,seed-synthetic}.ts`, `dev-db.sh`, script `seed:synthetic`, `apps/web/perf/puerta-m6.mjs`; `apps/ingest/test/synthetic.test.ts` (los datos sintéticos cumplen el contrato).

## Hallazgos no corregidos

- **`1m` es inalcanzable desde la UI**: el selector y el enlace solo llegan a 30 días (`DAYS_AVAILABLE`, `HISTORY_DAYS` = 30 días de Madrid) y la API sirve brutos hasta `ahora − 30 d`; el aviso «Datos antiguos» solo se ve forzando `applyState` o por la API. Es coherente hoy (retención = 30 d) pero ampliar el histórico exige subir ambos y decidir el selector (no es un arreglo pequeño). Con un día fuera de la lista el `<select>` queda en blanco.
- **La caché «inmutable» fija la resolución** de las ventanas pegadas al corte (la API y la CDN guardan `raw` aunque pasados unos minutos la ventana cruce el corte). Es inocuo (los brutos son más precisos) y ya estaba documentado en M6.2; solo confunde al medir.
- **Con la API sin BD (503)** la barra dice «Cargando datos…» ≈ 10 s antes de mostrar el error de red/servidor. Aceptable; se podría anunciar antes.
- **Arrastre bajo GL por software** (tabla): sin GPU cae a 20–35 fps. Mitigación posible (a medir en móvil real): limitar a ~4 Hz la luz del mapa y la reevaluación de capas durante el arrastre.
- **Carga a 600× contra un VPS real**: ≈ 2 ventanas/s en frío por usuario; la CDN/`immutable` lo absorbe, pero varios usuarios a la vez en frío superan `API_REPLAY_MAX_GLOBAL = 2` y el reloj espera. Medir en el VPS.
- Ventanas `1m` sin `meta` (línea del bus, nombre del barco) — ya anotado en M6.2.

## Límites de la prueba (qué NO demuestra)

- **Datos sintéticos**: trayectorias suaves, cadencia regular y sin huecos ni duplicados; los reales (GTFS estimado, AIS irregular, OpenSky, huecos de fuente) pueden dar ventanas mayores, más pistas y más huecos. Tamaños y latencias son de este conjunto.
- **No es móvil real**: Chrome de escritorio con viewport 390×844; ni CPU/GPU de teléfono, ni red móvil (latencia, pérdida), ni Safari/iOS.
- **No es producción**: sin Caddy/CDN, HTTP local, BD y API en la misma máquina, 60 h de datos (no 30 días), sin TLS ni `API_TRUST_PROXY`.
- Una sola IP/cliente: no se probó carga concurrente de varios usuarios.

## Pendiente (humano)

- Revalidar con datos reales tras el primer mes grabado (tamaños, huecos, fps a 600× con densidad real).
- Probar en un iPhone/Android reales (arrastre, 600×, consumo) y con la API tras Caddy.
- Decidir si el selector debe llegar más allá de 30 días (y entonces cómo se ve `1m`).
