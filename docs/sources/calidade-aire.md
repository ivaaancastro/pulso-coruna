# Calidad del aire en A Coruña

- **Verificado:** 2026-11-18 (UTC), con peticiones reales espaciadas ≥5 s. Sustituye a la nota anterior (que solo constataba que la web de MeteoGalicia usa una clave incrustada).
- **Licencia:** decisión humana tomada: «aceptada, con atribución». Los términos se citan abajo.
- **Recomendación:** principal **EEA Air Quality Download Service** (mediciones reales de las 4 estaciones de A Coruña, sin clave); respaldo **Open-Meteo Air Quality** (modelo CAMS, sin clave, siempre disponible).
- **Decisión humana (2026-11-19):** Open-Meteo aceptada (CC BY 4.0, uso no comercial), con atribución «Open-Meteo.com (datos CAMS)».

## Comparativa

| Fuente                                      | Real / modelo                                                   | Contaminantes (A Coruña)                                        | Frecuencia / latencia medida                                                   | Clave                                      | Límites                                     | Licencia                                | Encaje `Observation` / notas                                                                     |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **EEA Download Service** (e-reporting, E2a) | **Real**: 4 estaciones (15030001, 15030021, 15030027, 15030028) | NO2 (1 est.), PM10 (4), PM2.5 (3), O3 (2), SO2 (4), CO (3), NOx | Horaria; última hora válida ≈ 1–2 h antes de «ahora» (en 1 estación hasta 4 h) | No                                         | No documentados; ficheros Parquet de ~90 kB | EEA: reutilización libre con atribución | Muy bueno (`stationId` = id sampling point). Parquet (requiere lector → ADR); coordenadas aparte |
| **Open-Meteo Air Quality** (CAMS)           | **Modelo** (rejilla, no estaciones)                             | PM10, PM2.5, NO2, O3, SO2, CO, EAQI                             | Horaria, sin latencia (incluye previsión)                                      | No                                         | <10 000/día, 5 000/h, 600/min; no comercial | CC BY 4.0                               | Perfecto (JSON); `stationId` sintético, p. ej. `openmeteo:coruna`                                |
| MeteoGalicia Calidade do Aire               | Real                                                            | —                                                               | No medida                                                                      | Clave de API-manager incrustada (no usada) | —                                           | No localizada                           | Sin vía abierta localizada                                                                       |
| Open Data Xunta / datos.gob.es              | —                                                               | —                                                               | —                                                                              | —                                          | —                                           | —                                       | Catálogo dinámico; no se localizó un conjunto de aire con peticiones simples                     |
| MITECO tiempo real                          | Real                                                            | —                                                               | —                                                                              | —                                          | —                                           | —                                       | La URL de la página de tiempo real da 404; sin API estable localizada                            |
| OpenAQ v3                                   | Real (agregador)                                                | —                                                               | —                                                                              | **Sí** (HTTP 401 sin clave)                | —                                           | —                                       | No evaluada a fondo (clave gratuita: paso humano)                                                |
| WAQI / aqicn                                | Real (agregador)                                                | —                                                               | —                                                                              | **Sí** (token)                             | —                                           | —                                       | `token=demo` devolvió Shanghai; descartada                                                       |
| Concello da Coruña                          | —                                                               | —                                                               | —                                                                              | —                                          | —                                           | —                                       | No se localizó publicación abierta (la herramienta de búsqueda web no estuvo disponible)         |

## Fuente principal: EEA Air Quality Download Service

- **API:** `https://eeadmz1-downloads-api-appservice.azurewebsites.net` (Swagger en `/swagger/index.html`). Sin clave.
- **Flujo (2 pasos):**
  1. `POST /ParquetFile/urls` con JSON → devuelve un CSV de una columna (`ParquetFileUrl`) con una URL de blob por estación y contaminante.
  2. `GET` de cada URL `https://eeadmz1batchservice02.blob.core.windows.net/airquality-p/ES/SP_<estación>_<n>_<n>.parquet`.

  Petición usada (contaminantes por nombre: `NO2`, `PM10`, `PM2.5`, `O3`, `SO2`, `CO`; `dataset: 1` = no verificado / casi tiempo real; `aggregationType` válido: `hour`, `day`, `hour/day`, `var`):

  ```json
  {
    "countries": ["ES"],
    "cities": ["A Coruña"],
    "pollutants": ["NO2"],
    "dataset": 1,
    "source": "Api",
    "dateTimeStart": "2026-11-16T00:00:00Z",
    "dateTimeEnd": "2026-11-18T00:00:00Z",
    "aggregationType": "hour"
  }
  ```

- **Frecuencia/latencia:** el blob de NO2 se modificó a las 11:06 UTC y a las ~12:00 UTC la última hora con dato válido era la de 10:00–11:00 (hora de la fuente, ver riesgos); la hora en curso viene con `Validity: -1` y valor `-999`.
- **Estaciones:** `ES/SP_15030001`, `ES/SP_15030021`, `ES/SP_15030027`, `ES/SP_15030028` (15030 = A Coruña). Nombres y coordenadas **no vienen en el Parquet**: faltan del metadato de e-reporting (paso humano/por validar).
- **Fichero:** ~6 700 filas por serie (unos 9 meses de horas) aunque se pida un rango de 2 días: filtrar por `Start` en el adaptador.
- **Esquema Parquet:** `Samplingpoint`, `Pollutant` (código EEA: 1 SO2, 5 PM10, 6001 PM2.5, 7 O3, 8 NO2, 10 CO), `Start`, `End`, `Value` (decimal), `Unit` (`ug.m-3`; CO en `mg.m-3`), `AggType`, `Validity` (>0 válido, -1 sin dato), `Verification` (3 = no verificado), `ResultTime`, `DataCapture`, `FkObservationLog`.
- **Muestra real** (NO2, `ES/SP_15030001_8_8`, recortada):

  ```json
  {"Samplingpoint":"ES/SP_15030001_8_8","Pollutant":8,"Start":"2026-11-18T09:00","End":"2026-11-18T10:00","Value":19.0,"Unit":"ug.m-3","AggType":"hour","Validity":1,"Verification":3,"ResultTime":"2026-11-18T12:37"}
  {"Samplingpoint":"ES/SP_15030001_8_8","Pollutant":8,"Start":"2026-11-18T10:00","End":"2026-11-18T11:00","Value":12.0,"Unit":"ug.m-3","AggType":"hour","Validity":1,"Verification":3,"ResultTime":"2026-11-18T12:37"}
  {"Samplingpoint":"ES/SP_15030001_8_8","Pollutant":8,"Start":"2026-11-18T11:00","End":"2026-11-18T12:00","Value":-999.0,"Unit":"ug.m-3","AggType":"hour","Validity":-1,"Verification":3,"ResultTime":"2026-11-18T12:37"}
  ```

  Última hora válida por serie: 15030001 (10:00) — NO2 12, PM10 23, PM2.5 13, O3 70, SO2 15 µg/m³, CO 0,17 mg/m³; 15030021 — PM10 33 (09:00), PM2.5 8,8 (10:00), SO2 5,7 (10:00); 15030027 (07:00, retrasada) — PM10 57, PM2.5 31, O3 74, SO2 1, CO 0,22 mg/m³; 15030028 (09:00) — PM10 29, SO2 5,7.

- **Licencia (EEA, aviso legal, literal):** «Information, documents and material available on this website and for which the EEA holds the rights of use are public and may be re-used without prior permission, free of charge, for commercial or non-commercial purposes, provided that the EEA is always acknowledged as the original source of the material and that the original meaning or message of the content is not distorted. Such acknowledgment must be included in each copy of the material.» Y: «The re-use of certain data may be subject to different conditions…». Atribución propuesta: «Fuente: Agencia Europea de Medio Ambiente (EEA), Air Quality e-Reporting; datos notificados por España». Son datos no verificados: indicarlo como provisionales.

## Respaldo: Open-Meteo Air Quality (CAMS)

- `GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude=43.3623&longitude=-8.4115&current=pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide,european_aqi&timezone=UTC` (sin clave; `hourly=…&past_days=1` para histórico). Devuelve la celda 43.4/-8.4: es **modelo**, no estación; etiquetarlo como «estimado».
- **Muestra real:**

  ```json
  {
    "latitude": 43.4,
    "longitude": -8.4,
    "timezone": "GMT",
    "current_units": {
      "time": "iso8601",
      "interval": "seconds",
      "pm10": "μg/m³",
      "pm2_5": "μg/m³",
      "nitrogen_dioxide": "μg/m³",
      "ozone": "μg/m³",
      "sulphur_dioxide": "μg/m³",
      "european_aqi": "EAQI"
    },
    "current": {
      "time": "2026-11-18T11:00",
      "interval": 3600,
      "pm10": 11.1,
      "pm2_5": 4.3,
      "nitrogen_dioxide": 3.3,
      "ozone": 77.0,
      "sulphur_dioxide": 0.8,
      "european_aqi": 29
    }
  }
  ```

- **Términos (literal, open-meteo.com/en/terms):** «Less than 10'000 API calls per day, 5'000 per hour and 600 per minute. You may only use the free API services for non-commercial purposes. You accept to the CC-BY 4.0 licence». Atribución: Open-Meteo.com (datos CAMS).
- Contraste: el modelo da NO2 3,3 y PM10 11 µg/m³ frente a PM10 23–57 medidos en estaciones: subestima el aire urbano; sirve solo como respaldo/suelo.

## Mapeo a `packages/schema`

`Observation { stationId, layer: "air", metric, value, unit, ts }`:

- `stationId`: `ES/SP_15030001` (EEA, sin sufijo de contaminante) u `openmeteo:coruna`.
- `metric`: `no2 | pm10 | pm25 | o3 | so2 | co` (códigos EEA 8, 5, 6001, 7, 1, 10).
- `unit`: `µg/m³`; CO llega en `mg/m³` (declarar o convertir).
- `ts`: epoch ms UTC de una hora concreta (inicio o fin: decidir y documentar). Descartar `Validity <= 0` (`-999`).
- Las coordenadas de estación van en un catálogo aparte: `contract-change` si el contrato no lo cubre.

## Riesgos

- **Zona horaria de `Start` no confirmada:** e-reporting suele usar UTC+1 fijo y `ResultTime` (12:37) es posterior a la hora UTC de la petición (~12:00), lo que apunta a UTC+1. Verificar antes del adaptador; no asumir UTC ni `Europe/Madrid`.
- Formato Parquet: leerlo en Node exige una dependencia → ADR previo; no se probó si hay salida CSV.
- Ficheros con ~9 meses de histórico (~90 kB): consultar cada 30–60 min y cachear; retraso de 1–4 h y huecos (15030027 retrasada).
- Datos no verificados; API sin SLA publicado; el host de blobs puede cambiar: obtener siempre las URLs del paso 1.
- Sin nombres ni coordenadas de estación en el Parquet.
- Open-Meteo: solo no comercial; es modelo, no medición.

## Pasos humanos

1. Aprobar o rechazar un ADR para una librería Parquet (o localizar un formato CSV).
2. Obtener/validar nombres y coordenadas de las 4 estaciones (metadato EEA e-reporting o Xunta).
3. Confirmar la zona horaria de `Start` y el texto de atribución final.
4. Opcional: clave gratuita de OpenAQ v3 como tercer respaldo (no se creó ninguna cuenta).
