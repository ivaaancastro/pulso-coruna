# Teselas propias de A Coruña (M2.1)

OSM → PMTiles (vectorial, esquema OpenMapTiles 3.16) con [Planetiler](https://github.com/onthegomap/planetiler) v0.10.2. Resultado medido: **10,7 MiB (11,23 MB)**, zooms 0–16 (z15-16 solo en el casco urbano, ADR-0031), bbox `-8.58,43.27,-8.25,43.52` (bahía, península, Oleiros, Arteixo, Sada y Bergondo; el norte hasta 43,52 es mar abierto, para que la intro de cámara no muestre el borde de las teselas). Desde M2.7 las alturas de edificios usan plantas reales del Catastro (ver «Alturas reales»).

## Reproducir

Requisitos: Java 21, `curl`, ~3 GB de RAM libres y ~2 GB de disco (la primera vez; ver abajo). Nada se instala en global.

```bash
infra/tiles/build.sh                 # genera infra/tiles/.work/coruna.pmtiles (~3 min)
node infra/tiles/verify.mjs          # verifica (Node >= 20, sin dependencias)
```

`build.sh [salida.pmtiles]` descarga a `infra/tiles/.work/` (ignorado por git):

| Qué                                                        | De dónde                                                                                                                      | Notas                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Extracto OSM de Galicia (107 MB)                           | `https://download.geofabrik.de/europe/spain/galicia-261117.osm.pbf` (Geofabrik, datos OSM hasta **2026-11-17T21:24:30Z**)     | URL fechada y fija; para actualizar, cambia `OSM_URL`/`BOUNDS` en `build.sh` y vuelve a generar.                    |
| `planetiler.jar` v0.10.2 (93 MB)                           | GitHub Releases de Planetiler                                                                                                 | Se comprueba su SHA-256 (fijado en `build.sh`).                                                                     |
| Polígonos de agua, Natural Earth, lagos (~1,4 GB, una vez) | Los descarga Planetiler (`--download`): osmdata.openstreetmap.de, naturalearthdata.com, `lake_centerline` de openmaptiles.org | Imprescindibles para el mar y la costa (la costa de OSM no viene en el extracto como polígono). Quedan en `.work/`. |

Comando efectivo (lo que ejecuta `build.sh`):

```bash
# (tras fetch-catastro.mjs, DumpBuildings.java y build-heights.mjs; ver «Alturas reales»)
java -Xmx3g -cp .work/planetiler.jar CorunaTiles.java --heights=.work/heights.tsv --area=galicia \
  --download --download_dir=.work/sources \
  --tmpdir=.work/tmp --osm-path=.work/sources/galicia-261117.osm.pbf \
  --bounds=-8.58,43.27,-8.25,43.52 --minzoom=0 --maxzoom=16 \
  --exclude-layers=poi,housenumber,mountain_peak,aerodrome_label,aeroway,boundary \
  --detail-bounds=-8.48,43.31,-8.34,43.40 --base-maxzoom=14 \
  --nodemap_type=sortedtable --storage=ram --output=.work/coruna.pmtiles --force
```

## Alturas reales (M2.7, ADR-0013)

OpenMapTiles pone 5 m a los edificios sin `height` ni `building:levels` (≈ 45 % de los polígonos z14 en la primera versión). `build.sh` ahora completa las plantas con el **Catastro INSPIRE** (nota `docs/sources/catastro-edificios.md`; licencia aceptada por el humano, uso con atribución, solo información transformada):

1. `fetch-catastro.mjs`: descarga los ZIP ATOM de 8 municipios (~34 MB, a `.work/catastro/`; `node --use-system-ca` porque el servidor omite el certificado intermedio de FNMT).
2. `DumpBuildings.java`: vuelca las huellas OSM del bbox (`.work/osm-buildings.tsv`, ~10 s).
3. `build-heights.mjs`: cruza por centroide cada `BuildingPart` del Catastro con la huella OSM, toma el máximo de plantas y escribe `.work/heights.tsv` (`w<id>/r<id>` → plantas) solo para edificios sin altura real ni partes OSM. Imprime la cobertura antes/después.
4. `CorunaTiles.java`: copia de `OpenMapTilesMain` de Planetiler con un perfil que inyecta `building:levels` desde esa tabla antes de delegar; OpenMapTiles calcula `render_height = ceil(plantas × 3,66)`. Se publican solo plantas derivadas, nunca el dato del Catastro.

Medido (bbox completo): altura real 28,8 % → 75,1 % de los edificios; en A Coruña (bbox aprox.) 72,4 % → 93,8 %. Polígonos z14 con la altura por defecto de 5 m: 44,9 % → 20,5 %. Peso 6,85 → 7,67 MB. La extrusión sigue desde z14 (a z13 el perfil OpenMapTiles no emite `render_height`).

## ¿Se versiona el `.pmtiles`?

**No.** Pesa 6,85 MB, cabe en el límite, pero es un binario regenerable: cada actualización de OSM engordaría el historial de git. Se genera con el script y se sirve como fichero estático:

- Desarrollo local (M2.2): copiar a `apps/web/public/tiles/coruna.pmtiles` (esa ruta se ignora en M2.2) y cargarlo con el protocolo `pmtiles://`. Vite sirve peticiones `Range`.
- Producción (M3.6): Caddy sirve el fichero desde un volumen con `Range` habilitado; el navegador solo pide a nuestro dominio (regla de AGENTS.md).

## Capas y atributos (OpenMapTiles)

Zoom máximo 16 en el casco urbano (`DETAIL_BOUNDS`) y 14 en el resto del bbox (más allá, sobremuestreo en cliente); las capas `poi`, `housenumber`, `mountain_peak`, `aerodrome_label`, `aeroway` y `boundary` no se generan (el estilo no las usa). Atributos relevantes para el estilo (M2.2):

| Capa                                                                            | Contenido                        | Atributos clave                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `building`                                                                      | Edificios (z13+)                 | `render_height` (m, de `height` o `building:levels`), `render_min_height` (de `min_height`/`min_level`), `colour`, `hide_3d` |
| `water`, `waterway`, `water_name`                                               | Mar, ría, ríos; nombres de agua  | `class` (`ocean`, `lake`, `river`…), `intermittent`, `name`                                                                  |
| `landcover`, `landuse`                                                          | Cubierta y uso del suelo         | `class` (`grass`, `wood`, `residential`, `industrial`…), `subclass`                                                          |
| `park`                                                                          | Parques y reservas               | `class`, `name`                                                                                                              |
| `transportation`                                                                | Carreteras, vías de tren, sendas | `class` (`motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `minor`, `service`, `path`, `rail`…), `brunnel`, `oneway`  |
| `transportation_name`                                                           | Nombres de calles                | `name`, `class`, `ref`                                                                                                       |
| `place`                                                                         | Ciudad, barrios, localidades     | `class` (`city`, `suburb`, `town`, `village`…), `rank`, `name`                                                               |
| `boundary`, `aeroway`, `poi`, `housenumber`, `mountain_peak`, `aerodrome_label` | Resto del esquema estándar       | — (se pueden ignorar en el estilo; `poi` y `housenumber` son las que más pesan)                                              |

Notas de calidad medidas:

- Los edificios llegan **agrupados**: una feature por combinación de atributos (altura, altura mínima, color), como multipolígono. En z14 hay ~94 000 polígonos con `render_height` (100 %; OMT rellena un valor por defecto cuando OSM no trae altura ni niveles, así que no implica altura real en todos). Alturas frecuentes: 5 m (valor por defecto de OpenMapTiles cuando OSM no trae `height` ni `building:levels`; ≈ 45 % de los polígonos), 4, 22, 8, 19 m. Ver `docs/sources/catastro-edificios.md` (M2.7) para la cobertura real y las fuentes de alturas. Unos 4 000 polígonos tienen `render_min_height > 0` (voladizos, pasarelas).
- `fill-extrusion-height` = `["get","render_height"]`, `fill-extrusion-base` = `["get","render_min_height"]`; descartar `hide_3d` si aparece.
- Los nombres vienen en `name` (idioma local: gallego/castellano según OSM) más `name:*`; las capas de etiquetas llevan muchos `name:*` que el estilo no necesita. Si hace falta bajar peso, se pueden filtrar en M2.2 sin regenerar.

## Verificación

```bash
node infra/tiles/verify.mjs [ruta.pmtiles] [--max-mb 15]
```

Comprueba cabecera PMTiles v3, tamaño frente al límite (sale con código 1 si lo supera), bbox, zooms presentes, metadatos, capas requeridas (`building`, `water`, `waterway`, `landcover`, `landuse`, `park`, `transportation`, `transportation_name`, `place`, `boundary`) y recuento de polígonos de edificio con `render_height`. Salida real de la generación documentada:

```
Tamaño:     7.67 MB (límite 15 MB)
Zooms:      0-16
Bbox:       -8.5800, 43.2700, -8.2500, 43.5200
Tiles:      284 direccionados; 170 en z14
Edificios z14: 798 features (multipolígonos agrupados), ~94452 polígonos/anillos
  con render_height: 94452 (100.0 %); con render_min_height > 0: 4026
```

## Atribución y licencias

- Datos: © colaboradores de OpenStreetMap, [ODbL 1.0](https://www.openstreetmap.org/copyright). Las teselas son una **base de datos derivada**: si se redistribuyen, deben mantener la atribución y la ODbL.
- Alturas: plantas derivadas del Catastro INSPIRE; atribución «© Dirección General del Catastro (Ministerio de Hacienda)», también en los metadatos del PMTiles.
- Esquema y perfil: © OpenMapTiles (el perfil de Planetiler exige el crédito visible «© OpenMapTiles © OpenStreetMap contributors»; el esquema es CC-BY 4.0).
- La web debe mostrar en el mapa: `© OpenMapTiles © OpenStreetMap contributors © Dirección General del Catastro (Ministerio de Hacienda)` (con enlace a `https://www.openstreetmap.org/copyright`). Se cablea en M2.2 (`attribution` de la fuente).
- Auxiliares usados por Planetiler: polígonos de agua de OSM (ODbL), Natural Earth (dominio público). Planetiler: Apache-2.0 (no se redistribuye el jar).
