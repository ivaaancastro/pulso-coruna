# Portus (Puertos del Estado): mareas y oleaje

- **Verificado:** 2026-11-18 (UTC), con peticiones reales y espaciadas.
- **Web:** <https://portus.puertos.es/> (SPA Vue; sin JavaScript solo muestra un aviso). Servicio descrito en <https://www.puertos.es/servicios/oceanografia>.
- **API:** no hay API documentada. La propia SPA llama a `https://portus.puertos.es/portussvr/api` (leído en su `app.*.js`). Es una API interna: puede cambiar sin aviso.
- **Acceso:** sin clave ni cuenta. No se vio límite de peticiones (se hicieron unas 6 al API, separadas ≥5 s). El navegador del producto nunca la llama; solo el adaptador.
- **Licencia / términos:** no localizada. El portal institucional enlaza «Aviso legal», sin que se haya leído su texto. **Decidida por el humano (2026-11-18): aceptada, uso con atribución a la fuente.** Se consume la API interna de su web; si cambia sin aviso, ver riesgos. La SPA enlaza manuales «Descargaportus» en `bancodatos.puertos.es`, lo que sugiere un canal oficial de petición de datos: contactar con ellos lo decide el humano.

## Endpoints verificados

| Petición                                                           | Resultado                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ubicaciones/`                                                | 916 ubicaciones (puertos, localidades, playas). A Coruña puerto: `id` 12130, lat 43.359, lon -8.374. Otros: Langosteira 12140, Ferrol 12110. |
| `GET /estaciones/nearest/12130`                                    | `3219`: id del mareógrafo asociado al puerto de A Coruña.                                                                                    |
| `GET /mareografoDetalle/3219?locale=es`                            | Ficha: cero del puerto, nivel medio, etc.                                                                                                    |
| `GET /estaciones/variables/3219`                                   | `["SEA_LEVEL","AGITATION","SEICHE"]`                                                                                                         |
| `POST /lastData/station/3219?locale=es` con cuerpo `["SEA_LEVEL"]` | Último nivel medido (ver muestra).                                                                                                           |
| `GET /predData/portus/SEA_LEVEL_PLEABAJA/12130?locale=es`          | Pleamares y bajamares previstas (≈ 2 días).                                                                                                  |
| `GET /lastData/positions/3219`                                     | `[]` (no es móvil).                                                                                                                          |

El oleaje (boyas, p. ej. Sisargas/Villano) tiene endpoints en la SPA (`lastData/station/{id}` con variables de oleaje), pero **no se identificó el id de la boya más cercana ni se obtuvo muestra de oleaje**: pendiente.

## Muestra (recortada)

Último nivel, pedido a las ~11:43 UTC:

```json
{
  "fecha": "2026-11-18 11:42:00.0",
  "datos": [
    {
      "id": 27,
      "nombreParametro": "Nivel del mar",
      "nombreColumna": "nivel",
      "paramEseoo": "SeaLevel",
      "valor": "3507",
      "factor": 1000.0,
      "unidad": "m",
      "paramQC": false,
      "variable": "SEA_LEVEL",
      "averia": false
    }
  ]
}
```

Valor real = `valor / factor` = 3,507 m (viene como texto en milésimas). Referencia: cero del puerto (`ceroRedmar`).

Predicción de pleamar/bajamar (recortada):

```json
[
  {
    "fecha": "2026-11-18 03:12:00.0",
    "datos": [
      { "nombreParametro": "indicador", "variableParametro": "PLEABAJA", "valor": "0.0" },
      { "nombreParametro": "nivel", "variableParametro": "PLEABAJA", "valor": "2.506" }
    ],
    "ceroRef": "0"
  },
  {
    "fecha": "2026-11-18 09:35:00.0",
    "datos": [
      { "nombreParametro": "indicador", "variableParametro": "PLEABAJA", "valor": "1.0" },
      { "nombreParametro": "nivel", "variableParametro": "PLEABAJA", "valor": "3.815" }
    ],
    "ceroRef": "0"
  }
]
```

`indicador` 1 = pleamar, 0 = bajamar (inferido de los niveles; no documentado).

## Frecuencia

Última medición con 1 min de antigüedad respecto a la petición; **cadencia real no medida** (una sola muestra). Predicción de pleamar/bajamar: cálculo astronómico, estable por días.

## Zona horaria

`fecha` no lleva zona. La medición `11:42:00` coincidió con la hora UTC de la petición (11:43 UTC), por lo que se asume **UTC**. **Verificado (2026-11-19):** medición 14:56 con petición a las 14:57 UTC, siendo la hora local UTC+1. El adaptador (M5.1a) convierte a epoch ms UTC; métrica `tide_level` (ver `docs/specs/M5.1a-adaptador-mar.md`).

## Mapeo a `packages/schema`

- `Observation`: `layer: "sea"`, `stationId: "portus:3219"`, `metric: "tide_level"`, `value: 3.507`, `unit: "m"`, `ts` = `fecha` como UTC en epoch ms.
- Oleaje (pendiente de boya): `wave_height` (m), `wave_period` (s), `wave_dir` (°).
- La **predicción de pleamar/bajamar no encaja** en `Observation` (es futuro, no medida). Decidir: calcularla fuera del esquema o discutir un cambio de contrato (skill `contract-change`). No se toca el schema aquí.

## Riesgos

- API interna sin documentar ni garantías; puede romperse o limitar uso.
- Licencia y atribución sin confirmar (decidida por el humano: aceptada con atribución).
- Zona horaria inferida; valores como texto con `factor`.
- Falta identificar la boya de oleaje y su muestra.
- `paramQC: false` en la muestra: no se sabe si significa control de calidad pasado o no.
