# Fuente: MeteoGalicia (observación en estaciones)

Verificado el 2026-11-18 (UTC) con peticiones reales, sin clave ni cuenta. Capa `weather` (`Observation`).

## Veredicto sobre las tres estaciones

| id    | Estación                    | lat, lon             | Viento (10 min)                                                                                  |
| ----- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| 10157 | Coruña-Torre de Hércules    | 43.382763, −8.409202 | **No mide viento** (ni 10-min ni horario). Solo T, HR, lluvia, rocío, brillo del cielo nocturno. |
| 14000 | Coruña-Dique                | 43.36506, −8.374706  | Sí: velocidad, dirección, racha (+ presión, temperatura del agua)                                |
| 14003 | Punta Langosteira (Arteixo) | 43.34723, −8.531179  | Sí: velocidad, dirección, racha (+ presión, radiación, visibilidad)                              |

Consecuencia: para la capa de viento solo sirven **14000 y 14003**. 10157 aporta temperatura/humedad/lluvia. Si se quiere un tercer punto de viento hay que elegir otra estación de `listaEstacionsMeteo.action` (decisión humana; no se ha elegido).

## Endpoints (JSON, sin clave)

Base: `https://servizos.meteogalicia.gal/mgrss/observacion/`

- **Últimos datos 10-minutales** (el que usaremos): `ultimos10minEstacionsMeteo.action?idEst=10157,14000,14003` (varias estaciones separadas por coma; también admite `idParam=VV_AVG_10m,...`). Una sola petición cubre las tres. Sin `idEst` devuelve toda la red.
- Horario: `ultimosHorariosEstacions.action?idEst=14000` (últimas 2–3 h por defecto; admite `numHoras`). **Ojo**: el horario trae `VV_RACHA_10m` y `DV_AVG_10m` pero **no** `VV_AVG_10m` (velocidad media), por eso hace falta el 10-minutal.
- Lista de estaciones y coordenadas: `listaEstacionsMeteo.action`.
- Documentación oficial (PDF): `https://www.meteogalicia.gal/datosred/infoweb/meteo/docs/rss/JSON_ultimos10min_es.pdf` (y `_gl`), `JSON_EstacionHorarios_gl.pdf`, `JSON_listaEstacionsMeteo_es.pdf`. Códigos de parámetros: <https://www.meteogalicia.gal/web/observacion/parametros>.
- Nota: probar nombres de endpoint a ciegas da 404 (HTML de Tomcat). El nombre correcto del 10-minutal es `ultimos10minEstacionsMeteo`, no `ultimos10minEstacions`.

Parámetros de viento (códigos): `VV_AVG_10m` velocidad media 10 m (m/s), `DV_AVG_10m` dirección (º, procedencia), `VV_RACHA_10m` racha/refacho (m/s), `DV_CONDICION_10m` dirección de la racha (º), `VV_SD_10m`/`DV_SD_10m` desviaciones típicas.

## Licencia y atribución

- Las páginas del portal de datos abiertos de la Xunta (Abert@s) para estos servicios, «Estacións meteorolóxicas» (dataset 0114, servicio por estación) y «Datos horarios históricos…» (0689), declaran: **«Licenza: Creative Commons BY SA 4.0»**, «Fonte de datos: Meteogalicia». Fuente: <https://abertos.xunta.gal/catalogo/medio-abiente/-/dataset/0114/estacions-meteoroloxicas>.
- Las condiciones generales de Abert@s (<https://abertos.xunta.gal/condicions-de-uso-menu>) dicen que, salvo indicación contraria, los datos se publican bajo «Creative Commons Recoñecemento-Compartir Igual 4.0 Internacional (CC-by 4.0)» (la denominación mezcla BY-SA y BY), y piden: no alterar el contenido, no desnaturalizar su sentido, citar la fuente y mencionar la fecha de la última actualización. Fórmula de cita literal: **«Fonte dos datos: Xunta de Galicia»** (con enlace a <https://abertos.xunta.gal>). No se autoriza el uso de logotipos ni marcas.
- No se ha verificado que el endpoint `mgrss` en sí (distinto de la ficha del catálogo) lleve términos propios. La obligación de «compartir igual» (BY-SA) puede afectar a obras derivadas: **decidida por el humano (2026-11-18): aceptada, uso con atribución a la fuente** (licencia de nuestros datos derivados, atribución exacta, uso de la marca MeteoGalicia). No decidido aquí.

## Frecuencia real medida

- Paso de 10 minutos: dos instantes consecutivos observados, 11:30 y 11:40 UTC (`instanteLecturaUTC`).
- Retraso de publicación: a las 11:45:11 UTC el último instante disponible era 11:30; a las 11:47:10 ya estaba 11:40. Es decir, el dato de HH:M0 aparece unos 5–7 min después de su instante.
- Inconsistencia de caché/balanceador: a las 11:47:22 una petición devolvió 11:30 para 14000 cuando 12 s antes se había obtenido 11:40 (respuesta con `Set-Cookie` de sticky/ROUTEID, varios backends). El adaptador debe tolerar que el instante retroceda y quedarse con el mayor `ts` visto.
- Serie horaria: instantes en punto (11:00, 10:00, …), actualización cada hora.
- Medición adicional: ver «Medición» al final.
- Cadencia de sondeo propuesta: cada 5 min con ≥ 5 s entre peticiones y una sola petición con las tres estaciones (suficiente; pendiente de ratificar).

## Respuesta de ejemplo (recortada)

`GET .../ultimos10minEstacionsMeteo.action?idEst=10157,14000,14003`, 2026-11-18, instante 11:30 UTC. Se omiten parámetros no relevantes (14000 y 14003 traen además HR, PP, PR, PRED, TA, TO; 14003 también HSOL, RS, VB):

```json
{
  "listUltimos10min": [
    {
      "estacion": "Coruña-Torre de Hércules",
      "idEstacion": 10157,
      "instanteLecturaUTC": "2026-11-18T11:30:00",
      "listaMedidas": [
        {
          "codigoParametro": "TA_AVG_1.5m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Temperatura  a 1.5m",
          "unidade": "ºC",
          "valor": 17.18
        }
      ]
    },
    {
      "estacion": "Coruña-Dique",
      "idEstacion": 14000,
      "instanteLecturaUTC": "2026-11-18T11:30:00",
      "listaMedidas": [
        {
          "codigoParametro": "DV_AVG_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Dirección do vento a 10m",
          "unidade": "º",
          "valor": 185.0
        },
        {
          "codigoParametro": "VV_AVG_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Velocidade do vento a 10m",
          "unidade": "m/s",
          "valor": 10.18
        },
        {
          "codigoParametro": "VV_RACHA_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Refacho a 10m",
          "unidade": "m/s",
          "valor": 14.28
        }
      ]
    },
    {
      "estacion": "Punta Langosteira",
      "idEstacion": 14003,
      "instanteLecturaUTC": "2026-11-18T11:30:00",
      "listaMedidas": [
        {
          "codigoParametro": "DV_AVG_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Dirección do vento a 10m",
          "unidade": "º",
          "valor": 203.0
        },
        {
          "codigoParametro": "VV_AVG_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Velocidade do vento a 10m",
          "unidade": "m/s",
          "valor": 12.32
        },
        {
          "codigoParametro": "VV_RACHA_10m",
          "lnCodigoValidacion": 1,
          "nomeParametro": "Refacho a 10m",
          "unidade": "m/s",
          "valor": 16.5
        },
        {
          "codigoParametro": "PP_SUM_1.5m",
          "lnCodigoValidacion": 3,
          "nomeParametro": "Chuvia",
          "unidade": "L/m2",
          "valor": 0.0
        }
      ]
    }
  ]
}
```

Detalles: `instanteLecturaUTC` es UTC **sin sufijo `Z`** (hay que añadirlo antes de parsear: `Date.parse(s + "Z")`). Hay `nomeParametro` con espacios duros (U+00A0).

`lnCodigoValidacion` (documentación oficial del servicio horario): 0 sin validar, 1 válido original, 2 sospechoso, 3 erróneo, 5 válido interpolado, 9 no registrado. En la muestra, la lluvia de 14003 venía con código 3 (erróneo). El adaptador debe descartar al menos 3 y 9 (y decidir sobre 0, 2 y 5).

## Mapeo a `packages/schema`

`Observation` = `{ stationId, layer: "weather", metric, value, unit, ts }`; identidad `stationId:metric`.

| Origen (`codigoParametro`) | `metric`      | `unit` | `value`                      |
| -------------------------- | ------------- | ------ | ---------------------------- |
| `VV_AVG_10m`               | `wind_speed`  | `m/s`  | `valor`                      |
| `DV_AVG_10m`               | `wind_dir`    | `deg`  | `valor` (procedencia, 0–360) |
| `VV_RACHA_10m`             | `wind_gust`   | `m/s`  | `valor`                      |
| `TA_AVG_1.5m` (opcional)   | `temperature` | `degC` | `valor`                      |

- `stationId`: `String(idEstacion)` (`"14000"`, `"14003"`, `"10157"`); `layer`: `"weather"`.
- `ts`: `Date.parse(instanteLecturaUTC + "Z")` (epoch ms UTC). Es el instante del dato, no el de la petición.
- Los nombres de `metric` son una propuesta (el schema solo exige un string no vacío; `wind_speed` ya aparece en los tests del schema). Unidades: el schema solo pide string; se propone normalizar `º`→`deg`, `ºC`→`degC`. Pendiente de confirmar al crear el adaptador.
- Las coordenadas de las estaciones no caben en `Observation`; irán en configuración del adaptador/API (de `listaEstacionsMeteo.action`).
- `StationStatus` no se usa (es solo de bicis). No hace falta cambiar el contrato.

## Riesgos

- Licencia CC BY-SA 4.0 declarada en el catálogo (no la elegimos nosotros); atribución, «compartir igual» y marca: decidida por el humano (2026-11-18): aceptada, uso con atribución a la fuente.
- 10157 no tiene viento: el criterio «viento en 10157, 14000 y 14003» no se puede cumplir tal cual.
- Retraso de ~5–7 min y respuestas con instantes que retroceden por caché.
- Datos con códigos de validación (erróneos/sospechosos) mezclados en la respuesta.
- Servicio sin SLA ni límites publicados; la lista de parámetros por estación puede variar con el tiempo (sensores averiados).
- No se encontró documentación pública de límites de peticiones; se mantiene un uso mínimo (≥ 5 s entre peticiones, una petición por ciclo).

## Medición

Peticiones de 14000 entre 11:47 y 12:00 UTC (≈ 17 en total, siempre ≥ 5 s entre ellas, la mayoría con 40 s a 2 min):

- Instantes disponibles: 11:30 → 11:40 → 11:50 (paso exacto de 10 min).
- El instante 11:50 no estaba a las 11:57:58 y sí a las 11:58:42 (retraso ≈ 8 min); el 11:40 apareció entre 11:45:11 y 11:47:10 (retraso 5–7 min). Se asume un retraso de 5–9 min.
- A las 11:59:22 volvió a llegar 11:40 (tras haber visto 11:50), y a las 12:00:02 otra vez 11:50: **respuestas desordenadas** entre backends. El adaptador debe descartar instantes más antiguos que el último guardado.
- Con los datos de 14000, `VV_AVG_10m` pasó de 10.18 a 9.5 m/s y la racha de 14.28 a 13.51 m/s entre 11:30 y 11:40: el dato cambia en cada instante.
- Conclusión: sondear cada 5 min basta (como mucho se ve el dato nuevo con 5 min de retraso adicional); sondear más a menudo no aporta frescura.
