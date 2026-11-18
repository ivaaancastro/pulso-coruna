# Alturas de edificios: Catastro INSPIRE y alternativas (M2.7, fase 1)

- **Verificado:** 2026-11-18 (UTC). Objetivo: sustituir las alturas por defecto de los edificios de las teselas (M2.1) por alturas reales.
- **Estado:** fase 2 implementada (opción A, ADR-0013). **Licencia: aceptada por el humano (2026-11-18), uso con atribución, solo información transformada** (solo se publican plantas/alturas derivadas, nunca el dato original). Atribución: «© Dirección General del Catastro (Ministerio de Hacienda)», integrada en la UI y en los metadatos del PMTiles. El texto de §2.1 y §6 se conserva como registro de la investigación; la decisión 1 queda resuelta y la compatibilidad con ODbL (decisión 2) sigue como riesgo residual.

## 1. Cobertura actual de altura real en OSM (medida)

Extracto `galicia-261117.osm.pbf` (OSM hasta 2026-11-17), bbox de las teselas `-8.58,43.27,-8.25,43.45`. Medido con `infra/tiles/DumpBuildings.java` (volcado a TSV) y `infra/tiles/analyze-heights.mjs`.

OpenMapTiles (perfil Planetiler 0.10.2, desensamblado de `org.openmaptiles.layers.Building`) calcula `render_height = ceil(height)` si hay `height`; si no, `ceil(building:levels × 3.66)`; si no hay ninguno, **5 m por defecto**. `render_min_height` análogo con `min_height`/`min_level`.

| Medida (bbox completo)                                         |                   Edificios |      % |
| -------------------------------------------------------------- | --------------------------: | -----: |
| Polígonos `building=*`                                         |                      51 417 |        |
| …con `height` o `building:levels` propios                      |                      15 669 | 30,5 % |
| …solo con `height` (resto `building:levels`)                   |                          79 |        |
| …sin altura ni plantas (**por defecto, 5 m**)                  |                      35 748 | 69,5 % |
| Polígonos `building:part=*` (partes OSM)                       |                      31 958 |        |
| …con altura/plantas                                            |                      31 916 | 99,9 % |
| **Edificios con altura real (propia o vía partes OSM), total** | 15 726 de 51 417 (≈ 30,6 %) |        |
| A Coruña (bbox aprox. `-8.47,43.31,-8.36,43.40`)               |            14 306 de 19 753 | 72,4 % |
| Resto (Oleiros, Arteixo, Sada, Bergondo, Culleredo, Cambre…)   |             1 420 de 31 664 |  4,5 % |

Comprobación en el PMTiles z14 (`node infra/tiles/verify.mjs`, ahora con decodificación correcta de enteros): de 94 452 anillos, **42 428 (44,9 %) llevan `render_height` = 5 m** (el valor por defecto). Esto cuadra con lo anterior: las alturas más frecuentes son 5 (defecto), 4 (1 planta), 22, 8, 19, 26, 15, 11 m. Nota: la tabla «10, 8, 44, 16, 38» del README anterior estaba mal por un fallo de `verify.mjs` (no deshacía el zigzag de `sint_value`): eran el doble. Corregido.

Lectura: en el casco urbano de A Coruña OSM ya tiene mayormente plantas (importación previa del Catastro por la comunidad); en el área metropolitana, casi todo es altura inventada.

## 2. Fuentes evaluadas

### 2.1 Catastro INSPIRE, Edificios (DG del Catastro) — recomendada técnicamente

- **URLs oficiales (verificadas):**
  - ATOM, índice: `https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml` (actualizado 2026-08-21)
  - ATOM, provincia 15: `https://www.catastro.hacienda.gob.es/INSPIRE/buildings/15/ES.SDGC.bu.atom_15.xml`
  - ZIP por municipio, p. ej. A Coruña (15900): `https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/15/15900-A%20CORU%D1A/A.ES.SDGC.BU.15900.zip` (la Ñ va en latin-1)
  - WFS 2.0: `https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx?service=wfs&version=2&request=GetCapabilities` (tipos `bu:Building`, `bu:BuildingPart`, `bu:OtherConstruction`)
  - Página INSPIRE y licencia: `https://www.catastro.hacienda.gob.es/webinspire/index.html`, `…/documentos/Licencia.pdf`
- **Formato:** GML 3.2 INSPIRE (ZIP con `building.gml`, `buildingpart.gml`, `otherconstruction.gml`, metadatos `MD`). CRS **EPSG:25829** (huso 29, Galicia; no hay que reproyectar a mano si se usa WFS, que ofrece 4326/3857).
- **Atributo de plantas:** `bu-ext2d:numberOfFloorsAboveGround` en **`BuildingPart`** (las geometrías de `Building` lo traen siempre vacío, `nilReason="other:unpopulated"`). Una parte por volumen constructivo (id `<refcat>_partN`). Hay además `officialArea`, `currentUse`, `dateOfConstruction`. No hay altura en metros.
- **Cobertura A Coruña:** completa (suelo urbano y rural). Medido: 226 426 partes en los 8 municipios del bbox, 195 118 con centroide dentro del bbox, **0 sin plantas**; 15900 A Coruña = 58 847 partes.
- **Frecuencia:** el ATOM se regenera periódicamente (`Last-Modified` de los ZIP: 2026-08-21; sin frecuencia publicada, parece semestral). Fechas internas de cada parte en `beginLifespanVersion`.
- **Descarga (prueba real, anónima, sin formularios, 8 peticiones espaciadas 2 s, UA genérico):** ZIP de 15900 = 9,1 MB (219 MB descomprimido); Oleiros 6,7; Arteixo 4,1; Sada 3,1; Bergondo 2,4; Culleredo 3,5; Cambre 3,4; Abegondo 2,1 → **≈ 34 MB en total**. Guardado solo en `infra/tiles/.work/` (ignorado por git). **No se versiona fixture**: la licencia prohíbe difundir la información original sin transformar (ver abajo).
- **Límites de peticiones:** el ATOM no declara límites; la licencia permite suspender usuarios cuya «intensidad, frecuencia» perjudique al servicio. El **WFS no es práctico**: sin paginación, una consulta por bbox de 0,15 km² devuelve 3,7 MB y una de ~30 km² agotó el tiempo (30 s) sin respuesta; cubrir el bbox requeriría miles de peticiones. Usar ATOM.
- **Nota técnica:** `www.catastro.hacienda.gob.es` no envía el certificado intermedio de FNMT: `curl` falla verificando TLS. Node con `--use-system-ca` sí (sin desactivar verificación). El script `infra/tiles/fetch-catastro.mjs` ya lo usa así.
- **Licencia (literal):**
  - Feed ATOM de provincia 15 (`<rights>`): «This service can be used free of charge in every instance, as long as that the D. G. of the Cadastre (Ministry of Finance) is mentioned as author and owner of the information»
  - Feed ATOM raíz (`<rights>`): «Copyright (c) 2012", ES.SDGC; all rights reserved»
  - Metadatos ISO del ZIP: `otherConstraints` «no limitation»; `useLimitation` «No conditions apply»
  - «Licencia de acceso y uso de los servicios y conjuntos de datos INSPIRE de la DG del Catastro», v1.0, julio 2016 (`Licencia.pdf`): se autoriza «el uso público, incluido el comercial, de la información catastral que haya sido sometida a cualquier proceso previo de transformación» (art. 21 TRLPI); «no se autoriza la difusión, distribución o comercialización de la información original suministrada, que no puede ser difundida por Internet ni por ningún otro medio sin su previa transformación»; los nuevos productos «no suplantarán a los ofrecidos por la DG del Catastro» (no pueden identificarse como «cartografía catastral», «información catastral» o equivalentes); datos posiblemente desactualizados; el titular «deberá soportar las reclamaciones de terceros».
  - **No es CC BY 4.0 ni una licencia estándar**: los textos son contradictorios entre sí (copyright reservado / sin condiciones / uso libre con mención) y el PDF vigente es de 2016. **Atribución a preparar:** «Fuente: Dirección General del Catastro (Ministerio de Hacienda)» (no usar «información catastral» como nombre de producto). **Pendiente de decisión humana** (y de confirmar con la DG del Catastro si procede; lo decide el humano).
  - **Interacción con ODbL (OSM):** las teselas son base de datos derivada de OSM (ODbL, share-alike). Mezclar plantas del Catastro dentro de esa base y redistribuirla puede plantear incompatibilidad o exigir considerarlo obra transformada. **Pendiente de decisión humana.**

### 2.2 Concello da Coruña (datos abiertos, `datos.coruna.gal`, CKAN)

- Catálogo verificado por API (`/api/3/action/package_list`, `package_show`). No hay conjunto de edificios con plantas/alturas. Los relevantes:
  - `bta` «Base Topográfica Armonizada 1:5000» (cartografía 2014): servicios ArcGIS REST/WMS en `https://ide.coruna.gal/arcgiswa/rest/services/Publica/CB_WMS_BTA/MapServer`. Capa de edificación `EdiPobCons_pol`: sin campo de plantas ni altura (campos `TIPO_*`, `REVES_*`…). **Descartada.**
  - `modelo-digital-de-superficies-serie-historica` (MDS 2012, 1 m, WCS en `ide.coruna.gal`) y `modelo-digital-del-terreno` (MDT 2012/2014): permitirían un nDSM, pero **de 2012**, solo el término municipal, y el servicio MDS se describe como «Modelo Digital de Pendientes» (inconsistente; no verificado que sea superficie). **Descartada** como base (obsoleta, parcial).
- **Licencia (metadatos CKAN):** `license_id` «RISP_AC», «Condiciones generales documentos reutilizables del Ayuntamiento de A Coruna», `https://www.coruna.gal/opendata/avisolegal` (la URL redirige a la portada; **texto literal no localizado**). Los MDE históricos y la cartografía histórica figuran como CC-BY-4.0. **Pendiente de decisión humana** si se usara.

### 2.3 IGN / CNIG — LiDAR PNOA y modelos digitales

- **MDT (verificado):** WCS `https://servicios.idee.es/wcs-inspire/mdt` (GetCapabilities 200). Cobertura nacional, MDT de 5/25/200/500/1000 m «procedentes de sensores LiDAR aerotransportados del proyecto PNOA-LiDAR». Literal de `ows:Fees`: «No se aplican condiciones»; `ows:AccessConstraints`: «CC BY 4.0 scne.es». Es **terreno, no superficie**: no da alturas de edificios.
- **MDS / nube de puntos LiDAR (PNOA-LiDAR):** serviría para calcular un nDSM real (MDS − MDT) por huella. **No verificado:** el Centro de Descargas (`https://centrodedescargas.cnig.es`) es una aplicación interactiva con selección en sesión; no existe WCS de MDS en `servicios.idee.es` (la ruta `…/mds` rechazó la conexión) y no se ha probado la descarga directa (evita formularios). La licencia CC BY 4.0 de PNOA-LiDAR la indica el propio servicio MDT; texto literal de las condiciones de descarga no localizado → pendiente. Tamaños típicos: nube de puntos ≈ 30–100 MB por hoja de 2×2 km (estimación, sin medir); el bbox exige decenas de hojas (>1 GB). Fecha de vuelo de Galicia no verificada.
- Ventaja: cobertura homogénea y altura métrica real (incluye cubierta). Inconvenientes: necesidad de procesar rásteres/LAZ (sin GDAL ni PDAL instalados; Java/Node sin dependencias), desfase temporal y árboles/vegetación contaminando el nDSM.

### 2.4 Otras

- **Xunta/IDEG** (Mapa topográfico de Galicia 1:5000 y edificaciones): no localizada en esta sesión una capa con plantas; no verificada (sin acceso a buscador). Pendiente de investigar si se quiere ampliar.
- **Overture Maps / Microsoft Building Footprints / GHSL:** alturas modeladas (baja resolución en GHSL, estimadas por ML en otros); licencias mixtas (ODbL/CDLA). No evaluadas en detalle; peor calidad que plantas catastrales.

## 3. Resultado de la fusión (simulación, solo análisis)

Cruce espacial (centroide de cada `BuildingPart` catastral dentro del polígono OSM `building=*`, altura candidata = máximo de plantas), sin tocar teselas:

| Zona                       | Edificios OSM | Real hoy | Real con Catastro |
| -------------------------- | ------------: | -------: | ----------------: |
| Total bbox                 |        51 417 |   30,6 % |        **80,6 %** |
| A Coruña (aprox.)          |        19 753 |   72,4 % |            93,8 % |
| Resto (área metropolitana) |        31 664 |    4,5 % |            72,4 % |

- Edificios sin altura real ni partes OSM: 35 691; se les podría asignar plantas en 25 721 (72,1 %). El resto (27,9 %) son sobre todo construcciones auxiliares sin parte en `buildingpart` (están en `otherconstruction.gml`, no cruzado) y huellas OSM sin equivalente.
- **Acuerdo con OSM donde ambos existen** (12 646 edificios con `building:levels`): coincide en el 64,0 %; Catastro +1 planta en 14,2 %, −1 en 5,8 %; diferencias ≥ 4 plantas en 3,5 % (suelen ser OSM con levels de una parte y no del total). Catastro cuenta plantas sobre rasante (sin ático/cubierta inclinada); la altura es plantas × 3,66 m, convención de OpenMapTiles.
- Precisión de la reproyección implementada a mano (UTM29N→WGS84, serie de Snyder): sub-métrica, suficiente para la intersección.

## 4. Método técnico para fusionar con OSM

Hecho verificado: en Planetiler, `SourceFeature.tags()` de los elementos OSM es **mutable** (probado en 446 768 edificios sin error). Se puede, pues, inyectar `building:levels` antes de delegar en el perfil OpenMapTiles.

**Opción A (recomendada): tabla `osm_id → plantas` + wrapper de perfil**

1. `fetch-catastro.mjs` (hecho): descarga los 8 ZIP (~34 MB).
2. Volcado OSM (hecho, `DumpBuildings.java`, ~7 s) y cruce en Node (hecho como análisis, ~3 s) → `heights.tsv` (`way_id<TAB>plantas`).
3. Programa Java de una sola clase (`java -cp planetiler.jar Pulso.java`, sin Maven ni deps npm) que crea el perfil `OpenMapTilesProfile` envuelto: en `processFeature`, si es polígono `building` sin `height` ni `building:levels`, hace `tags().put("building:levels", n)`. Mantiene `render_height`/`render_min_height`/`hide_3d`/`colour` tal cual (OpenMapTiles).

- **Pros:** reutiliza todo el perfil OMT (agua, costa, nombres); huellas y colores OSM intactos; el resultado difiere poco de hoy en tamaño; compatible con la extrusión actual (`fill-extrusion-height` = `render_height`); reproducible (versiones fijadas).
- **Contras:** un paso Java propio a mantener y el cruce por centroide no cubre edificios con muchas partes complejas (se puede mejorar con área de intersección); `building:part` de OSM sin plantas no se completan.
- **Peso:** los valores de `render_height` pasan de «5 m» (44,9 % de los anillos, muy compresibles al agruparse) a valores variados: estimado **+0,3 a +1 MB** sobre 6,85 MB (muy por debajo de 15 MB). No medido (no se ha generado).
- **Esfuerzo:** 1–1,5 días (cableado Java + README + ADR + pruebas con fixture transformada).
- **Riesgo:** bajo técnicamente; alto legal (ver §2.1 y §6).

**Opción B: usar las huellas del Catastro como capa `building`** (Planetiler con fuente GeoJSON). Pros: 100 % con plantas, huellas catastrales exactas. Contras: 195 k polígonos (≈ 2× los 94 k actuales; el peso de z14 podría pasar de 4,6 a ~9 MB, cerca del límite), pierde atributos OSM (colour, nombres), obliga a reescribir la capa y mezclar fuentes de huellas. Más riesgo de peso y de licencia (se redistribuye geometría catastral, aunque transformada).

**Opción C: nDSM a partir de LiDAR (MDS − MDT).** Altura métrica real, incluye cubierta. Contras: descarga interactiva del CNIG sin verificar, decenas de hojas (>1 GB), procesado ráster sin herramientas, vegetación y desfase; esfuerzo 3–5 días. Interesante a largo plazo (licencia CC BY 4.0 declarada), no ahora.

**Opción D: dejar el 5 m por defecto** pero ocultar la extrusión sin altura real (`fill-extrusion-height` sin dato → plano): la web podría distinguir con un atributo; no mejora las alturas.

### z13 (sin alturas)

Causa verificada en el desensamblado de `org.openmaptiles.layers.Building`: la capa se emite desde `setMinZoom(13)`, pero `render_height`, `render_min_height`, `colour` y `hide_3d` se añaden con `setAttrWithMinzoom(…, 14)`; no es `hide_3d`. Además, a z13 `building_merge_z13` (por defecto activado) fusiona edificios cercanos por clases iguales (sin atributos → una masa). Subir los atributos a z13 **no se puede cambiar por configuración** (es código compilado del perfil): hay que sustituir la clase `Building` por una copia propia o aplicar un wrapper que reemita la feature. Coste de peso estimado: z13 ocupa hoy 1,18 MB (z14: 4,64 MB); con atributos y sin fusión se estima 2–3 MB (+1 a +2 MB), cabría en 15 MB, pero el mapa a z13 (~1 : 70 000) con extrusiones aporta poco y cuesta fps. **Recomendación:** mantener extrusión desde z14 (estilo con `minzoom` 14 para la capa extruida) y tratar z13 aparte si el humano lo pide.

## 5. Recomendación

**Opción A** con Catastro como fuente de plantas: sube la altura real del 30,6 % al ~80,6 % de los edificios del bbox (93,8 % en la ciudad; 4,5 % → 72,4 % en el entorno), ~34 MB de descarga, ~1–1,5 días, sin dependencias nuevas, peso casi sin cambio. **Pero no se implementa (fase 2 omitida)** porque la licencia no es «claramente de reutilización abierta con atribución» y hay una posible fricción con ODbL.

## 6. Decisiones humanas necesarias

1. **Licencia del Catastro:** ¿se acepta el texto «uso libre con mención de la DG del Catastro como autor y titular» junto con la Licencia v1.0 (2016; solo productos transformados, sin suplantar «cartografía/información catastral», sin responsabilidad)? ¿Se pide confirmación formal a la DG del Catastro (lo decide el humano; yo no contacto con terceros)?
2. **Compatibilidad con ODbL:** si se incorporan plantas catastrales a las teselas (base derivada de OSM), ¿se acepta redistribuirlas bajo ODbL, o se considera «obra transformada» del Catastro? Valorar la alternativa de no publicar el `.pmtiles` y solo servir teselas renderizadas, o usar B/C con licencias claras.
3. **Atribución** (si se acepta): texto sugerido «© Dirección General del Catastro (Ministerio de Hacienda)» junto a «© OpenMapTiles © OpenStreetMap contributors». **No se ha integrado en la UI.**
4. Si se prefiere una fuente con CC BY 4.0 inequívoca: autorizar investigar PNOA-LiDAR (opción C), que exige descarga interactiva del CNIG.

## 7. Cómo reproducir las mediciones

```bash
node --use-system-ca infra/tiles/fetch-catastro.mjs                      # ~34 MB en infra/tiles/.work/catastro/
java -Xmx3g -cp infra/tiles/.work/planetiler.jar infra/tiles/DumpBuildings.java \
  infra/tiles/.work/sources/galicia-261117.osm.pbf infra/tiles/.work/osm-buildings.tsv -8.58,43.27,-8.25,43.52
node infra/tiles/build-heights.mjs                                       # cifras de §1 y §3 (y escribe heights.tsv)
node infra/tiles/verify.mjs                                              # % de altura por defecto en el PMTiles
```

## Riesgos

- Licencia ambigua y posible incompatibilidad con ODbL (principal).
- Datos del Catastro con fecha 2026-08-21: edificios nuevos o demolidos tras esa fecha; OSM al 2026-11-17.
- Plantas ≠ altura: cubiertas, áticos, plantas bajas altas; error típico ±1 planta (14 % +1, 6 % −1 donde se comparó).
- `www.catastro.hacienda.gob.es` con cadena TLS incompleta: depender de `--use-system-ca`.

## Resultado de la fase 2 (implementada)

Teselas regeneradas con `infra/tiles/build.sh` (bbox `-8.58,43.27,-8.25,43.52`): 25 672 edificios reciben `building:levels` del Catastro.

| Medida                                       | Antes (v. anterior) | Después |
| -------------------------------------------- | ------------------: | ------: |
| Edificios OSM con altura real, bbox completo |              28,8 % |  75,1 % |
| …en A Coruña (bbox aprox.)                   |              72,4 % |  93,8 % |
| …resto del bbox                              |               4,8 % |  64,8 % |
| Anillos z14 con la altura por defecto de 5 m |              44,9 % |  20,5 % |
| Peso del PMTiles                             |             6,85 MB | 7,67 MB |

(Con el bbox anterior 43,45 la cobertura real era 30,6 % → 80,6 %; al ampliar al norte entran ~4 000 edificios de Ares/Mugardos/Ferrol cuyo municipio no se descarga del Catastro, por eso baja el porcentaje del bbox completo.) Los 5 m restantes son construcciones sin `BuildingPart` catastral (anexos, `otherconstruction`) y municipios no descargados.
