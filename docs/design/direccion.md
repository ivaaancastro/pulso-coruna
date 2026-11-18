# Dirección de arte: «Faro»

> Estado: **aprobada por el humano (2026-11-18)** (M1.6). Vigente desde la aprobación. Moodboard: `moodboard.md`. Valores listos para CSS: `tokens.md`. Frames de referencia: `mockups/postal.svg`.

## Idea

La ciudad se lee como lo que mira un faro: negro profundo, una masa de agua casi plana y puntos de luz que son datos. La Torre de Hércules es el único elemento «permanente» con luz propia: un haz lento que barre la bahía y marca el pulso (un giro cada 20 s; en el índice Pulso alto, algo más vivo, nunca más de 12 s).

Una apuesta, el resto en silencio: **la luz cálida y ancha de las cifras y del haz frente a un mapa casi apagado**. Todo lo demás (mapa, paneles, controles) se retira.

Reglas que salen de ahí:

- Solo brilla el dato. El mapa base nunca supera la luminancia de una entidad.
- Una tonalidad por capa y además una **forma** y un **movimiento** por capa (el color nunca es el único canal).
- Poca interfaz: hora grande, índice grande, un selector de modo. Sin tarjetas, sin sombras, sin glassmorphism.

## Paleta

Fondo y mapa base (el mar es la masa dominante: azul tinta, no negro puro, para que se distinga de la tierra).

| Token             | Hex       | Uso                                    |
| ----------------- | --------- | -------------------------------------- |
| `bg`              | `#05080E` | Fondo de página, cielo, fuera del mapa |
| `land`            | `#0A0F19` | Tierra                                 |
| `water`           | `#0B2236` | Agua (más clara que la tierra)         |
| `water-deep`      | `#06131F` | Agua lejos de costa (degradado)        |
| `building`        | `#1A2438` | Edificios extruidos (techo)            |
| `building-side`   | `#111827` | Fachada                                |
| `surface`         | `#0C1220` | Paneles y controles                    |
| `surface-overlay` | `#141C2E` | Menús, diálogos                        |

Texto: `text` `#E8EEF7`, `text-muted` `#8E9BB0`, `text-subtle` `#7A88A4`.

Capas (una tonalidad por capa):

| Capa           | Token   | Hex       | Forma redundante                          | Movimiento                              |
| -------------- | ------- | --------- | ----------------------------------------- | --------------------------------------- |
| Bus            | `bus`   | `#FFC23D` | Punto con estela larga siguiendo calle    | Continuo, estela 20–30 s                |
| BiciCoruña     | `bike`  | `#6BE8A4` | Anillo fijo en estación; relleno = nivel  | Respira solo al cambiar disponibilidad  |
| Viento         | `wind`  | `#C9DCF5` | Partículas finas, sin relleno             | Flujo continuo, velocidad = intensidad  |
| Mar / marea    | `sea`   | `#22C7D9` | Línea horizontal con marca de nivel       | Sube y baja lento (ciclo de marea)      |
| Barcos         | `ship`  | `#FF7A59` | Triángulo orientado al rumbo              | Deriva lenta, estela corta              |
| Aire (calidad) | `air`   | `#A78BFA` | Halo difuso (heatmap), sin borde          | Pulso de 6 s según nivel                |
| Aviones        | `plane` | `#F5F1E4` | Cruz fina orientada al rumbo, altitud=tam | Rápido y recto, estela fina             |
| Tren           | `train` | `#F45CD8` | Cuadrado alargado sobre la vía            | Continuo, sin estela (va por raíl fijo) |

Estados: `warn` `#FFB020`, `error` `#FF6B6B`, `focus` = `plane` `#F5F1E4`.

### Contraste (WCAG 2.x, calculado con luminancia relativa sRGB)

Texto y UI sobre `surface` `#0C1220`:

| Par                                        | Ratio | Criterio AA              |
| ------------------------------------------ | ----- | ------------------------ |
| `text` sobre `surface`                     | 16,03 | 4,5 texto: cumple        |
| `text-muted` sobre `surface`               | 6,65  | cumple                   |
| `text-subtle` sobre `surface`              | 5,24  | cumple                   |
| `text` sobre `surface-overlay`             | 14,57 | cumple                   |
| `focus` sobre `surface`                    | 16,55 | 3 componentes UI         |
| `border-control` `#5A6A88` sobre `surface` | 3,43  | 3 componentes UI: cumple |
| `error` sobre `surface`                    | 6,74  | cumple                   |
| `warn` sobre `surface`                     | 10,23 | cumple                   |

Capas sobre `bg` (cuando se usan como texto o icono en leyenda; todas cumplen ≥ 4,5):

bus 12,44 · bike 13,08 · wind 14,36 · sea 9,77 · ship 7,81 · air 7,37 · plane 17,74 · train 7,03.
Texto oscuro `bg` sobre relleno de capa (chips): ≥ 7,03 en todas.

Excepciones deliberadas, no son UI: la diferencia `water`/`land` (1,18) y `building`/`land` (1,24) es baja a propósito; el mapa base es decorativo, y la información que lleva (costa) se refuerza con un trazo de costa `#1E3A55`. Bordes decorativos (`border-hairline` `#243049`) no se usan para delimitar controles.

### Daltonismo

Método: simulación de protanopía, deuteranopía y tritanopía con las matrices de Machado et al. (2009, severidad 1,0) y distancia ΔE76 en CIELAB entre cada par de las ocho tonalidades de capa. Resultados (par más cercano en cada caso):

| Visión       | Par más cercano                                                                | ΔE   |
| ------------ | ------------------------------------------------------------------------------ | ---- |
| Normal       | wind / sea (calculado con la paleta previa: 11,8; no recalculado con la final) | ~11  |
| Protanopía   | air / train                                                                    | 10,4 |
| Deuteranopía | sea / train                                                                    | 6,3  |
| Tritanopía   | bike / sea                                                                     | 10,0 |

Lectura honesta: 6,3 en deuteranopía (sea/train) está por debajo de lo cómodo (~10). Por eso el color nunca va solo: cada capa tiene forma y movimiento distintos (tabla anterior) y sea (línea de marea en la UI) y train (cuadrado sobre vía) no coinciden en el mismo sitio ni forma. Además, la leyenda pone el nombre de la capa junto al color. M2 debe verificarlo con capturas simuladas (Chrome DevTools → Rendering → emular deficiencias de visión) en `design-review`. Si el humano prefiere más margen, alternativa para tren: `#E05CF0` → a validar.

Los ΔE son de simulación, no de personas; recomendable una comprobación con una persona daltónica antes del lanzamiento.

## Tipografía

Una sola familia con carácter, variable en anchura: **Archivo** (variable, ejes `wght` 100–900 y `wdth` 62–125).

- Cifras grandes (hora, índice): `wdth` 125 (expandida), `wght` 300–400, cifras tabulares (`font-variant-numeric: tabular-nums`). La expansión ancha da cadencia de rótulo de cine; el peso fino evita parecer dashboard.
- UI y texto: `wdth` 100, `wght` 400/500; etiquetas pequeñas con `wdth` 90 para ahorrar espacio.
- Texto en castellano y gallego: Archivo cubre latín extendido (ñ, acentos).

Licencia y fuente (a verificar en el momento de descargar en M2.4, no he podido contrastar el texto en origen desde esta sesión):

- Licencia: SIL Open Font License, Version 1.1 («This Font Software is licensed under the SIL Open Font License, Version 1.1.»). Texto completo: <https://openfontlicense.org> (`OFL.txt` del repositorio).
- Copyright (según el repositorio): «Copyright 2019 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)».
- Fuente: <https://github.com/Omnibus-Type/Archivo> y <https://fonts.google.com/specimen/Archivo>.
- Autoalojada: se descargará el `.woff2` variable en M2.4 (no se añade al repo en esta tarea). Subset latín (U+0020–007E, U+00A0–00FF, U+2013–2014, U+2019, U+2212) en un solo fichero. Objetivo ≤ 40 KB. El navegador nunca llama a Google Fonts (regla de 0 peticiones a terceros). El texto de la OFL va en `apps/web/public/fonts/OFL.txt`.
- Fallback: `system-ui, sans-serif` con `font-display: swap`; la hora se renderiza con el fallback sin saltos porque el contenedor tiene ancho fijo en `ch`.
- Comprobar en M2.4: que la fuente incluye la característica `tnum` en el subset (si no, se mantiene en el subset); si falla, alternativa: Sora o Inter (también OFL).

Escala (móvil 390 px → escritorio; ratio ≈ 1,333, base 16 px):

| Token     | Móvil | Escritorio | Peso / anchura | Uso                          |
| --------- | ----- | ---------- | -------------- | ---------------------------- |
| `display` | 64 px | 120 px     | 300 / 125      | Hora o índice a pantalla     |
| `title`   | 28 px | 40 px      | 400 / 110      | Nombre de modo, valor grande |
| `body`    | 16 px | 16 px      | 400 / 100      | Texto                        |
| `label`   | 13 px | 13 px      | 500 / 90       | Leyendas, ejes               |

Interlineado: 1,0 en display, 1,5 en body. Longitud de línea máx. 60 caracteres. Sin versalitas para etiquetas; frases normales en minúscula.

## Movimiento

Principios: cámara de dron (aceleración suave, inercia), nada lineal salvo lo que es físico (un bus a velocidad constante), nada que rebote. El movimiento de UI es mínimo: aparece cuando responde a una acción.

Curvas:

- `ease-drone`: `cubic-bezier(0.22, 0.61, 0.36, 1)` (entrada y salida suave, para cámara y paneles).
- `ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)` (aparición de UI).
- `ease-in`: `cubic-bezier(0.5, 0, 0.75, 0)` (salida).
- `linear`: solo para movimiento físico (entidades).

Duraciones: `instant` 80 ms (hover, foco) · `fast` 160 ms (controles) · `base` 280 ms (paneles) · `slow` 600 ms (capas) · `camera` 2200 ms (vuelo) · `intro` 3800 ms.

Capas, entrada y salida: una capa **no hace slide**; entra por opacidad 0→1 en `slow` y su estela se «dibuja» desde las entidades (no aparece de golpe). Sale por opacidad en `base`. Una capa sin dato (fuente caída) se atenúa a 35 % de opacidad en `slow` y muestra su estado en la leyenda; nunca desaparece sin aviso.

Entidades: interpolación lineal entre mensajes (dato real no se «suaviza» con curvas). Nueva entidad: crece de 0 a su tamaño en 280 ms. Entidad que desaparece: se apaga en 600 ms.

Modos: cambiar entre Ahora, Reproducir y Escuchar no recarga la escena: cruza el color de la UI en `base`. Reproducir muestra una barra de tiempo fina; Escuchar añade un círculo de pulso (un anillo que sale desde el centro con el índice).

`prefers-reduced-motion: reduce`: sin vuelo ni haz que barre ni respiración; las entidades se desplazan (son dato, no decoración) pero sin estelas animadas largas; cambios por fundido de 80 ms. La intro es un frame estático con fundido de 200 ms.

## Postprocesado

Decisión: **sin pasada de bloom por defecto en v1.** Razones: un bloom a pantalla completa en WebGL2 con 4 a 6 desenfoques cuesta del orden de 1–3 ms de GPU en móvil de gama media (estimación, a medir) y el presupuesto es ≥ 58 fps (16,6 ms) con todas las capas más deck.gl y edificios extruidos. No hay margen demostrado, y el CI no mide GPU.

En su lugar, el «brillo» se consigue barato dentro de las capas:

1. Mezcla aditiva (`blendMode additive`) en estelas y puntos: donde se cruzan se acumula luz.
2. Halo: segunda capa `ScatterplotLayer` con radio 3× y alfa ≈ 12 % bajo cada punto (solo para bus, barco y avión visibles; limitar a ≤ 2000 instancias).
3. Haz y niebla del faro: degradado dibujado en el canvas del mapa, sin post.

Bloom real: solo opcional en nivel de calidad «alto» (escritorio con GPU), apagado si cae < 45 fps durante 3 s (misma regla de degradación del roadmap). Se reevalúa en M2.5 con medición real (skill `perf-budget`). Si no se demuestra margen, no entra.

## Guion de la intro (≤ 4 s)

Objetivo: situar (bahía, península, Torre) y dar hambre de interactuar. Interrumpible con cualquier toque, tecla o rueda; entonces salta al final sin cortar en seco (fundido `fast`).

| Tiempo      | Cámara y escena                                                                                                                                                                                           | UI            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 0,0 – 0,4 s | Negro. Aparece el haz del faro (fundido) sobre agua casi negra, cámara alta sobre la bahía (inclinación 20°).                                                                                             | nada          |
| 0,4 – 3,2 s | Vuelo `ease-drone` bahía → península, bajando a inclinación 58° y girando 25°. Los edificios extruidos emergen del negro por distancia. Los primeros puntos (bus y bici) se encienden al pasar la cámara. | nada          |
| 3,2 – 3,8 s | La cámara se asienta en la órbita lenta del modo Ahora; entra la hora (fundido `base`).                                                                                                                   | hora          |
| 3,8 – 4,0 s | Entra el índice Pulso; el control de modo aparece al final.                                                                                                                                               | índice, modos |

Con `prefers-reduced-motion`: frame final estático con fundido de 200 ms, sin vuelo. Si los datos aún no llegaron: la intro usa datos de fixture etiquetados, nunca se bloquea esperando a la red. Primer fotograma < 2,0 s (presupuesto): la intro empieza en negro y no cuenta contra el presupuesto mientras el primer fotograma del mapa llegue a tiempo.

## Guion de la demo de 15 s

Pieza para el README y redes; la graba el humano o un script Playwright con el modo vídeo.

| Tiempo    | Plano                                                                                                                              | Mensaje en pantalla (gallego/castellano, ≤ 6 palabras) |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0 – 3 s   | Intro de cámara (guion anterior, recortada a 3 s).                                                                                 | «A Coruña, ahora mismo.»                               |
| 3 – 6 s   | Órbita lenta sobre la ciudad; se encienden capas una a una (bus, bici, viento).                                                    | índice Pulso con su valor                              |
| 6 – 10 s  | Acelera: modo Reproducir, un día completo en 4 s (tiempo con cifras tabulares corriendo). Se ve la hora punta de buses y la marea. | hora en `display`                                      |
| 10 – 13 s | Modo Escuchar: aparece el anillo de pulso; la imagen marca el ritmo del audio.                                                     | «Escúchala.»                                           |
| 13 – 15 s | Plano final del faro con el haz; aparece el nombre y la URL.                                                                       | «Pulso A Coruña» + URL                                 |

Reglas: sin música de fondo adicional (solo la sonificación real); sin voz en off; exportar a 1080×1920 y 1920×1080.

## Qué debe aprobar el humano

Ver la lista al final de `tokens.md` y el informe de la tarea. Resumen: nombre del concepto («Faro»), paleta (sobre todo tren/sea por daltonismo), tipografía (Archivo) y su licencia, no usar bloom por defecto, guiones.
