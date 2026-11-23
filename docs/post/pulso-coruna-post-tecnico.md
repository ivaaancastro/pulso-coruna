# Pulso A Coruña: una ciudad como organismo vivo (borrador de post técnico)

> **Borrador, sin publicar.** Todas las cifras salen de mediciones del repositorio y se citan en el [README](../../README.md#presupuestos-y-números-reales). Donde no se ha medido pone «pendiente». Antes de publicar: revisar tono, confirmar el estado de las licencias de las fuentes y sustituir el GIF (datos simulados) por una toma con datos reales.

## El problema

Quería ver A Coruña moverse: buses, bicis, viento, marea, barcos, aire y aviones sobre un mapa 3D nocturno, poder rebobinar el día y, de paso, escucharlo. Una web de portfolio, sin monetización, que se vea bien en un móvil normal y cueste lo que un VPS pequeño (objetivo ≤ 10 €/mes).

Eso pone tres límites desde el principio: los datos son de terceros y de calidad desigual, el navegador no puede depender de ellos (CORS, claves, límites) y el presupuesto de rendimiento hay que defenderlo con medidas, no con buenas intenciones.

## Arquitectura

Un monorepo pnpm con TypeScript estricto y cinco piezas:

- `packages/schema`: contrato en zod. Todo dato externo se normaliza a tres formas: `Entity` (algo que se mueve), `StationStatus` (algo con un estado, como una estación de bici) u `Observation` (una medida, como el viento).
- `packages/adapters`: un adaptador por fuente, probado solo con fixtures grabadas. Ningún test llama a una API real.
- `apps/ingest`: sondea las fuentes con intervalos y reintentos con espera creciente, anota su salud (`source_health`) y escribe en TimescaleDB.
- `apps/api`: Fastify con un snapshot REST, un WebSocket de deltas, el histórico en MessagePack y el índice Pulso.
- `apps/web`: Vite y TypeScript sin framework, MapLibre GL con deck.gl encima.

Todo corre con Docker Compose y Caddy en un VPS. La regla que más simplifica la seguridad: **el navegador solo habla con nuestro dominio**. Las claves viven en el servidor y un test comprueba que durante la carga y la interacción hay 0 peticiones a terceros.

El mapa base es propio: un PMTiles generado con Planetiler desde un extracto de OpenStreetMap, ajustado a A Coruña. Pesa 8,04 MB. Las alturas de los edificios eran el problema visual: solo el 28,8 % tenía altura real en OSM y el resto salía como cajas de 5 m. Cruzando las plantas del Catastro con las huellas de OSM subió al 75,1 % (93,8 % en la ciudad).

## Decisiones que cambiaron el producto

**Estimar la posición de los buses.** La API de iTranvías no es oficial ni tiene condiciones de uso claras, así que la dejé apagada hasta tener permiso. En su lugar, un estimador puro calcula desde el GTFS dónde _debería_ estar cada servicio ahora: interpola en el tiempo sobre la distancia a lo largo del trazado, nunca hacia atrás, y se queda quieto en las paradas. Esas posiciones se marcan como «estimado según horario» en la ficha y en la leyenda: no son seguimiento en vivo, y la web no finge que lo sean. Si algún día hay posiciones reales, llegan por el mismo contrato y se distinguen por el id.

**El presupuesto como puerta.** Desde el segundo hito el CI falla si se rompe el peso de JS, si el navegador llama a terceros o si los fps regresan. El JS inicial es de 15,6 KB gzip frente a un presupuesto de 250 KB, porque todo lo pesado va en chunks diferidos. El diferido (mapa, deck.gl y capas) está en 560,5 KB frente a 565 KB. Ese límite lo he subido dos veces con un ADR cada vez, y el margen actual es de unos 4,5 KB: la próxima capa tendrá que pagarse con carga por capa.

**Trabajo fuera del hilo principal.** El WebSocket, la validación con zod y la interpolación de posiciones viven en un Web Worker que devuelve buffers transferibles. En un banco en Node el motor tarda 0,05 ms de mediana por fotograma. Es el coste del cálculo, no una medida de Chrome en un móvil.

**Una máquina del tiempo barata.** Reproducir pide ventanas de 5 minutos en MessagePack con enteros cuantizados; con datos sintéticos una ventana de 7 capas pesa unos 11 KB. La retención guarda 30 días en bruto y después una muestra por minuto y entidad. La demo prometida en el plan, «un día entero en 15 s», era imposible: 24 h a 600× son 144 s. Lo corregí en el roadmap en vez de inventar una velocidad.

**Sonificar sin librerías.** «Escuchar» usa Web Audio nativo: pentatónica menor de La, corcheas a 90 bpm, un máximo de 16 voces con robo por prioridad y un limitador a la salida. Cada capa tiene su timbre (percusión suave para bicis, un drone grave para la marea, ruido filtrado para el viento). Va apagado por defecto y se carga solo al activarlo. Sin librería, el presupuesto de JS no se resiente, y con una escala pentatónica casi cualquier combinación de eventos suena bien.

**El índice Pulso, con honestidad.** El índice (0–100) compara la actividad con «lo habitual» para ese tipo de día y hora: 50 es lo normal y 100, el doble. Como aún no hay un mes de histórico, «lo habitual» es una tabla fija estimada, y la interfaz lo dice («perfil fijo: nivel sin calibrar»). Cuando haya cuatro semanas grabadas, pasará a un perfil aprendido sin cambiar el contrato.

## Errores y aprendizajes

- **El medidor de bundle me mentía.** El script solo contaba los chunks cuyo nombre casaba con un patrón; al llegar las capas de deck.gl, los chunks nuevos no casaban y el check daba «OK» con el peso real muy por encima del presupuesto. Ahora mide todo lo que no es inicial, service worker o worker. Moraleja: un check verde sin haberlo visto fallar no demuestra nada.
- **Un import inocente costó 28 KB.** Validar la respuesta del índice con zod en el hilo principal añadía unos 28 KB gzip al chunk diferido. Moverlo a un worker lo dejó fuera del presupuesto y fuera del hilo principal.
- **Una petición de más al abrir un enlace.** Al abrir una URL con un instante, el modo Reproducir pedía primero una ventana de «hace una hora» y solo después saltaba al instante del enlace. La primera consumía uno de los dos cupos globales de la API. Lo encontré midiendo las peticiones en la puerta del hito.
- **Los fps de un runner no son los de un móvil.** En CI no hay GPU, así que WebGL va por software. Con GPU real, la línea temporal mantiene 60 fps a 600× y al arrastrar; con SwiftShader a 390×844 cae a unos 20 fps. Ese segundo número es sintético y solo sirve para detectar regresiones. Lo que importa es el móvil real, que está pendiente.
- **Los datos sintéticos son optimistas.** Trayectorias suaves, cadencia regular, sin huecos. Los números de tamaño y latencia de Reproducir valen para ese conjunto; los reales (AIS irregular, huecos de fuente) probablemente los empeoren.

## Números (resumen)

| Qué                                            | Cifra                         | Fuente                               |
| ---------------------------------------------- | ----------------------------- | ------------------------------------ |
| JS inicial (gzip)                              | 15,6 KB (presupuesto 250 KB)  | `pnpm perf:bundle`                   |
| JS diferido (gzip)                             | 560,5 KB (presupuesto 565 KB) | `pnpm perf:bundle`                   |
| Teselas propias                                | 8,04 MB                       | tamaño del fichero                   |
| fps con GPU de escritorio, 390×844             | 60,0 de media, 59,9 de p5     | `PERF_FPS_PROFILE=gpu pnpm perf:e2e` |
| fps con WebGL por software                     | 46,6 de media (sintético)     | `pnpm perf:e2e`                      |
| Peticiones a terceros                          | 0                             | test `third-party.spec.ts`           |
| Tests automáticos                              | 1258 en verde                 | `pnpm -r test`                       |
| fps, primer fotograma, LCP e INP en móvil real | pendiente                     | M8.3 (humano)                        |
| Coste real de producción                       | pendiente                     | M8.8 (humano)                        |

## Qué falta

Probar en un móvil real y antiguo, cerrar las licencias de las fuentes que aún están pendientes (también la de iTranvías, de la que depende que los buses sean reales), desplegar «por pasos» (cerrado, local y global) y medir el coste real del VPS. Hasta entonces, cualquier cifra de rendimiento en móvil o de coste sería una suposición, y por eso no está en este texto.

El código y las decisiones están documentados en el repositorio: especificaciones en `docs/specs/` y un ADR corto por cada decisión técnica importante.
