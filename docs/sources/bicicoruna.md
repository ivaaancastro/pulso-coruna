# Fuente: BiciCoruña

Verificado el 2026-11-18 (UTC) con peticiones reales, sin clave ni cuenta. Es la capa `bike` (`StationStatus`).

## Veredicto

**Sí hay disponibilidad en vivo por estación** (bicis, bicis eléctricas, anclajes libres, estado), en JSON, sin autenticación. No es GBFS: es la «API SmartCity» del Concello. No localizado un GBFS oficial (el dominio típico de GBFS de Smovengo/PBSC, `coruna.publicbikesystem.net`, no resuelve; SOFIA no se ha probado: no se ha encontrado ni hace falta).

## Acceso

- Catálogo: <https://datos.coruna.gal/dataset/bicicletas-publicas-bicicoruna> (CKAN; organización EMVSA). Metadatos vía `https://datos.coruna.gal/api/3/action/package_search?q=bici`.
- Recurso «API SmartCity Estacións BiciCoruña» (JSON, «Frecuencia de actualización: Continua» según el catálogo):
  `GET https://csc-api.coruna.eu/api-manager/server/api/v1/estaciones_bicicoruna/getAssets`
- Sin clave, sin cabeceras especiales; HTTP/2, `content-type: application/json`, ~37 KB para 79 estaciones. Todas las estaciones en una sola petición, sin paginación ni filtros observados.
- Límites de uso: no localizados. Pendiente de decisión humana si se quiere confirmar con el Concello (no contactado).

## Licencia y atribución

- El catálogo declara la licencia `RISP_AC`: «Condiciones generales documentos reutilizables del Ayuntamiento de A Coruna» (URL declarada: <https://www.coruna.gal/opendata/avisolegal>).
- **No se ha podido leer el texto**: esa URL redirige (301) a una página genérica del portal del Concello cuyo contenido no es el aviso legal. Atribución requerida: **no localizada**.
- **Pendiente de decisión humana**: leer el aviso legal real, decidir si el uso (web pública, histórico grabado, portfolio) cumple y qué atribución mostrar. No se asume ninguna.

## Frecuencia real medida

- El campo `dateModified` viene **vacío en las 79 estaciones**: la respuesta no trae marca de tiempo del dato. `ts` de nuestro `StationStatus` será la hora de nuestra petición, no del dato (documentarlo; la frescura real es desconocida).
- Cambios observados cada ~2 min en los totales (ver «Medición» al final). Frecuencia de refresco interna de la fuente: no medida con precisión.

## Respuesta de ejemplo (recortada: 2 de 79 estaciones)

```json
[
  {
    "_id": { "assetId": "10" },
    "BikeHireDockingStation": {
      "id": "10",
      "type": "BikeHireDockingStation",
      "stationCode": "10",
      "stationName": "Mirador de los Castros",
      "category": "",
      "status": "working",
      "availableBikeNumber": 2,
      "availableElectricalBikeNumber": 1,
      "freeSlotNumber": 17,
      "totalSlotNumber": 19,
      "outOfServiceSlotNumber": 0,
      "location": { "coordinates": [43.3539722, -8.3904889], "type": "Point" },
      "address": "Centro Deportivo San Diego",
      "description": "",
      "dateModified": "",
      "ownership": "emvsa"
    }
  },
  {
    "_id": { "assetId": "11" },
    "BikeHireDockingStation": {
      "id": "11",
      "stationCode": "11",
      "stationName": "Los Rosales",
      "status": "working",
      "availableBikeNumber": 16,
      "availableElectricalBikeNumber": 6,
      "freeSlotNumber": 9,
      "totalSlotNumber": 25,
      "outOfServiceSlotNumber": 0,
      "location": { "coordinates": [43.3743246, -8.4319872], "type": "Point" }
    }
  }
]
```

(La segunda entrada omite campos para abreviar; la real los trae todos.)

## Observaciones sobre los datos (79 estaciones el 2026-11-18)

- `location.coordinates` es **`[lat, lon]`**, el orden contrario a GeoJSON. Rango observado: lat 43.323–43.383, lon −8.444 a −8.390 (todas en A Coruña).
- `status`: solo se vio `working` (79/79). Otros valores posibles: desconocidos.
- `availableBikeNumber` parece **incluir** las eléctricas (`availableElectricalBikeNumber` ≤ `availableBikeNumber` salvo en 2 estaciones de 79, que lo incumplen: 80 → 4 vs 5, 19 → 4 vs 5). Interpretación no confirmada.
- `availableBikeNumber + freeSlotNumber + outOfServiceSlotNumber ≠ totalSlotNumber` en 20 de 79 estaciones (p. ej. id 13: 13+6+0 ≠ 19). No se puede asumir la invariante; usar `freeSlotNumber` tal cual.
- `outOfServiceSlotNumber` fue 0 en las estaciones inspeccionadas.
- Total observado: ~483–488 bicis, ~269 eléctricas.

## Mapeo a `packages/schema`

`StationStatus` = `{ id, layer: "bike", lon, lat, bikes, docks, ts }`.

| Campo schema | Origen                                                                      | Nota                                                |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------- |
| `id`         | `BikeHireDockingStation.id` (string)                                        | estable; coincide con `stationCode` y `_id.assetId` |
| `layer`      | constante `"bike"`                                                          |                                                     |
| `lon`, `lat` | `location.coordinates[1]`, `[0]`                                            | **invertido** respecto a GeoJSON                    |
| `bikes`      | `availableBikeNumber`                                                       | entero ≥ 0                                          |
| `docks`      | `freeSlotNumber`                                                            | anclajes libres (no `totalSlotNumber`)              |
| `ts`         | `Date.now()` de la petición (epoch ms UTC)                                  | la fuente no da hora (`dateModified` vacío)         |
| (sin campo)  | `availableElectricalBikeNumber`, `status`, `stationName`, `totalSlotNumber` | **no caben** en el schema actual.                   |

Si se quieren eléctricas, nombre o estado, hace falta un cambio de contrato (skill `contract-change`); aquí no se toca `packages/schema`. Estaciones con `status` distinto de `working`: decidir en el adaptador (descartar o `bikes`/`docks` a 0); pendiente.

## Riesgos

- Licencia `RISP_AC` sin texto leído ni atribución definida: pendiente de decisión humana.
- Sin marca de tiempo en el dato: no se puede detectar un dato congelado salvo comparando con la petición anterior.
- API de «SmartCity» con nombre de host y ruta de gestor de APIs: sin SLA ni documentación localizada; puede cambiar o pedir clave.
- Invariante de anclajes rota en ~25 % de las estaciones; coordenadas en orden no estándar.
- Dependencia: el navegador nunca llama aquí; solo nuestro adaptador (regla del proyecto).

## Medición

Seis peticiones entre 11:46 y 11:57 UTC (una cada ~2 min, ≥ 10 s tras una petición a MeteoGalicia). Totales (bicis disponibles / anclajes libres): 488/975 (11:47), 479/987 (11:49), 477/987 (11:51), 471/992 (11:53), 464/1000 (11:55), 466/997 (11:57). Los datos cambian en tiempo real, con variaciones perceptibles en menos de 2 min: la fuente es viva, no una foto horaria.

No se pudo medir el retraso real (la respuesta no trae hora). Cadencia de sondeo propuesta: cada 60 s con una petición por ciclo (pendiente de ratificar; el catálogo anuncia actualización «Continua» y no publica límites).
