# GTFS Compañía de Tranvías de A Coruña

Verificado el 2026-11-18 (tarea M1.1).

## Fuentes probadas

| Fuente                    | URL                                                     | Resultado                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobility Database (ficha) | https://mobilitydatabase.org/feeds/gtfs/mdb-2767        | Existe. Título: «La Coruña Tram Company SA, Raw data from the Spanish National Access Point, powered by MIMTRANS». Es una SPA: la licencia no aparece en el HTML. |
| Mobility Database (API)   | https://api.mobilitydatabase.org/v1/gtfs_feeds/mdb-2767 | Redirige a login (requiere cuenta). No usada.                                                                                                                     |
| Espejo MDB del zip        | https://files.mobilitydatabase.org/mdb-2767/latest.zip  | **HTTP 200 sin registro.** 3 766 478 bytes, `last-modified` 2026-11-14 01:04 UTC.                                                                                 |
| NAP                       | https://nap.transportes.gob.es                          | Portada accesible (200). No se probó la ficha del conjunto ni su descarga: **pendiente de acción humana: registro en NAP** si lo exige.                           |
| Web de la compañía        | https://www.tranviascoruna.com/                         | Accesible (200). Sin mención de GTFS, datos abiertos ni licencia en el HTML de la portada.                                                                        |

El título del feed en MDB indica que procede del NAP (MITMA). La URL original del productor no se pudo comprobar, porque la API de MDB exige login.

## Método de acceso

- Descarga directa por HTTP GET del espejo de MDB, sin clave, cuenta ni límites observados.
- NAP: acceso oficial pendiente de acción humana (registro en NAP); no se creó cuenta.
- Dependemos de un espejo de terceros; para producción conviene confirmar la URL oficial del NAP.

## Licencia / términos de uso

**No localizada.** Ni la ficha de MDB (SPA), ni la portada de la compañía, ni la portada del NAP daban texto de licencia accesible sin registro. **Pendiente de decisión humana**: licencia, atribución y condiciones de redistribución.

## Frecuencia y vigencia

- Archivos del zip con fecha 2026-11-13; espejo actualizado 2026-11-14.
- `calendar.txt`: 4 863 servicios del **2026-11-13 al 2026-12-31**.
- `calendar_dates.txt`: 387 653 excepciones (tipos 1 y 2) entre 2026-01-01 y 2026-12-31.
- Vigencia corta: caduca el 2026-12-31. El adaptador debe re-descargar periódicamente y avisar cuando queden pocos días de vigencia. No se midió la cadencia histórica de publicación (solo una muestra).
- No hay `feed_info.txt`: no hay versión ni fechas de feed declaradas.

## Validación (estructura)

Comprobación propia de integridad referencial con un script ad hoc (no se usó el validador oficial de MobilityData):

- Archivos: `agency`, `routes`, `stops`, `trips`, `stop_times`, `calendar`, `calendar_dates`, `shapes`. Sin `feed_info`, `frequencies` ni `transfers`.
- 1 agencia: «Tranvías de La Coruña, S.A.» (`Europe/Madrid`, `es`).
- 25 rutas (`route_type` 3, autobús) con 24 nombres cortos distintos (BUH aparece en dos rutas): 1, 1A, 2, 2A, 3, 3A, 4, 5, 6, 6A, 7, 11, 12, 12A, 14, 17, 20, 21, 22, 23, 23A, 24, BUH, UDC.
- 538 paradas definidas, 469 usadas en `stop_times`; bbox lat 43.295–43.384, lon -8.457 a -8.379 (A Coruña).
- 15 038 viajes, 358 012 `stop_times`, 69 `shape_id`, 15 755 puntos de shapes.
- Integridad: 0 viajes con `service_id` desconocido, 0 `stop_id` inválidos, 0 viajes sin `stop_times`, 0 `stop_times` huérfanos.

Resultado: estructura válida y consistente. Los `service_id` son casi uno por viaje, lo que explica el tamaño de `calendar_dates`.

## Muestra (recortada)

`agency.txt`

```
agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone
9,"Tranvías de La Coruña, S.A.",http://www.tranviascoruna.com,Europe/Madrid,es,+34981250100
```

`routes.txt`

```
route_id,agency_id,route_short_name,route_long_name,route_type
100,9,1,Abente y Lago-Castrillón,3
200,9,2,Abente y Lago-Os Castros,3
```

`stops.txt`

```
stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon
1,1,"Porta Real","",43.370115,-8.39585
2,2,"Av.Mariña,T.Rosalía","Av. da Mariña, Teatro Rosalía",43.369768,-8.399365
```

`trips.txt`, `stop_times.txt`, `calendar.txt` (primeras filas de datos)

```
100,100010650,100010650,A. Lago,1,10001
100010650,06:50:00,06:50:00,68,1
100010650,06:50:58,06:50:58,69,2
100010650,1,1,1,1,1,0,0,20261113,20261231
```

## Riesgos

- Licencia y atribución sin confirmar (decisión humana).
- Vigencia corta (fin 2026-12-31): sin renovación, el mapa de buses se queda sin horarios.
- Único acceso verificado: espejo de terceros (MDB); puede cambiar de URL.
- Es horario teórico, no posiciones en vivo (eso es iTranvías, M1.2); la correspondencia de `trip_id` con tiempo real no está comprobada.
- Tamaño: ~45 MB descomprimido (`stop_times` 12,8 MB, `calendar_dates` 8,7 MB); procesar en streaming.
- Horas GTFS pueden pasar de 24:00:00 (no comprobado); el adaptador debe admitirlo.
