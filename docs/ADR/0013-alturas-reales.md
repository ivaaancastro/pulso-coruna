# ADR-0013: alturas reales de edificios con plantas del Catastro

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

OpenMapTiles asigna 5 m a los edificios sin `height` ni `building:levels` (45 % de los polígonos z14; solo el 30 % de edificios con altura real). Nota: `docs/sources/catastro-edificios.md`.

## Decisión

`build.sh` cruza las plantas de `BuildingPart` del Catastro INSPIRE (ATOM, 8 municipios) con las huellas OSM por centroide (máximo de plantas) y un perfil Java (`CorunaTiles.java`, subclase de `OpenMapTilesProfile`, sin deps npm) inyecta `building:levels` solo si OSM no trae altura ni niveles. Licencia aceptada por el humano (uso con atribución, solo información transformada): se publican plantas derivadas, no el dato original; atribución «© Dirección General del Catastro (Ministerio de Hacienda)» en la UI. Bbox ampliado al norte (43,52, mar) por la intro de cámara.

## Consecuencias

Altura real 28,8 % → 75,1 % (ciudad 93,8 %), peso 6,85 → 7,67 MB. +4 pasos de build (~1 min) y dependencia del servidor del Catastro (TLS con `--use-system-ca`). Plantas × 3,66 m ±1 planta; sin alturas a z13; riesgo residual de compatibilidad ODbL a vigilar.
