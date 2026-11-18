# OpenSky Network (aviones)

- **Verificado:** 2026-11-18 (UTC). Peticiones reales anónimas (sin cuenta), 5 en total, separadas ≥ 5 s.
- **Docs:** <https://openskynetwork.github.io/opensky-api/rest.html>. **Endpoint:** `GET https://opensky-network.org/api/states/all`.
- **Acceso:** anónimo posible, sin clave. Las cuentas (OAuth2) dan más cuota; no se creó ninguna (acción humana).
- **Límites anónimos (docs):** solo el estado más reciente (`time` se ignora); resolución temporal de 10 s; **400 créditos al día**, cuota independiente por endpoint (`/states`, `/tracks`, `/flights`), renovación diaria, por IP. Coste de `/states/all` según el área del bbox (grados²): ≤ 25 → 1 crédito; 25–100 → 2; 100–400 → 3; > 400 o global → 4. Agotado: HTTP 429 con `X-Rate-Limit-Retry-After-Seconds`.
- **Verificado:** `x-rate-limit-remaining` pasó de 399 a 398 en dos peticiones consecutivas con bbox pequeño (1 crédito cada una).
- **Presupuesto:** 400 peticiones/día ≈ una cada 216 s sostenida las 24 h. Una cada 5 min (288/día) cabe con margen, y obliga a interpolar posiciones (rumbo y velocidad vienen en el dato). Una cuenta gratuita (4 000/día según la tabla de la documentación) sería la mejora; decisión humana.
- **Licencia / términos:** no localizada. La página de términos (`/about/terms-of-use`) devolvió **403** a una petición automatizada y la documentación REST consultada no contiene texto de licencia. **Pendiente de decisión humana** (uso, atribución, almacenamiento y reproducción histórica). Recordar que OpenSky podría limitar usos comerciales (no verificado).

## Bbox de A Coruña

`lamin=43.25&lomin=-8.65&lamax=43.50&lomax=-8.20` (0,25° × 0,45° = 0,11 grados² → 1 crédito). Incluye el aeropuerto de Alvedro (LCG, ≈ 43,30 N, -8,38 W) y su corredor de aproximación.

Resultado a las 11:40 UTC (dos peticiones): `{"time":1795002004,"states":null}`, es decir **ninguna aeronave dentro del bbox** en ese momento. El tráfico es escaso: la capa estará casi vacía muchas horas, y a baja cota la cobertura ADS-B puede faltar.

## Muestra (recortada)

Petición con un bbox mayor sobre Galicia (`lamin=42.5&lomin=-9.5&lamax=44&lomax=-7.5`, solo para ver el formato), 3 de 7 filas:

```json
{
  "time": 1795002025,
  "states": [
    [
      "344195",
      "ANE68DM ",
      "Spain",
      1795001945,
      1795001946,
      -8.425,
      42.9254,
      518.16,
      false,
      64.26,
      165.63,
      -3.9,
      null,
      525.78,
      "3441",
      false,
      0
    ],
    [
      "4854cb",
      "TRA11T  ",
      "Kingdom of the Netherlands",
      1795002024,
      1795002024,
      -7.5304,
      42.7687,
      10066.02,
      false,
      201.37,
      203.49,
      -5.2,
      null,
      10340.34,
      "3741",
      false,
      0
    ],
    [
      "344695",
      "VLG9VQ  ",
      "Spain",
      1795002024,
      1795002024,
      -8.4858,
      43.0265,
      1082.04,
      false,
      106.55,
      91.94,
      -2.6,
      null,
      1104.9,
      "4535",
      false,
      0
    ]
  ]
}
```

Orden de campos (docs): 0 `icao24`, 1 `callsign` (8 caracteres con relleno), 2 país, 3 `time_position` (s), 4 `last_contact` (s), 5 `longitude`, 6 `latitude`, 7 `baro_altitude` (m), 8 `on_ground`, 9 `velocity` (m/s), 10 `true_track` (°), 11 `vertical_rate` (m/s), 12 `sensors`, 13 `geo_altitude` (m), 14 `squawk`, 15 `spi`, 16 `position_source`, 17 `category` (solo con `extended=1`). Muchos campos pueden ser `null`.

## Frecuencia

Resolución de 10 s para anónimos; en la muestra `time_position` iba 0–80 s por detrás de `time`. La cadencia efectiva la fija la cuota (ver Presupuesto).

## Mapeo a `packages/schema`

`Entity`, `layer: "plane"`:

- `id`: `icao24`.
- `lon`/`lat`: campos 5/6; descartar filas con `null`.
- `heading`: `true_track`; `speed`: `velocity` (ya en m/s).
- `ts`: `time_position * 1000` (epoch ms UTC; si `null`, `last_contact * 1000`). Sin multiplicar, los segundos no pasan el mínimo `1e11` del esquema.
- `meta`: `callsign` (sin espacios), `alt` (`geo_altitude` o `baro_altitude`, m), `onGround` (0/1; `meta` solo admite string o number), `vrate`.

## Riesgos

- Cuota diaria baja y por IP; con 429 el adaptador debe espaciar y degradar.
- Términos de uso no localizados: pendiente de decisión humana.
- Cobertura a baja altura y sobre el mar irregular; la capa puede estar vacía.
- API sin SLA; el modelo de límites y autenticación ha cambiado antes (ahora OAuth2): releer la documentación.
- Son datos de aeronaves, no de personas; aun así, no identificar propietarios.
