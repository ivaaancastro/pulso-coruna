# ADR-0009: teselas propias con Planetiler y PMTiles

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

El navegador solo habla con nuestro dominio y el mapa base debe ser propio, ligero (≤ 15 MB) y con altura de edificios.

## Decisión

Planetiler v0.10.2 (jar con SHA-256 fijado, no es dependencia npm, no se versiona) genera un PMTiles OpenMapTiles desde un extracto fechado de Geofabrik Galicia (2026-11-17) recortado a `-8.58,43.27,-8.25,43.45`, zooms 0–14: 6,85 MB. El `.pmtiles` no se versiona (se regenera con `infra/tiles/build.sh`); se sirve como estático con `Range`.

## Alternativas

Tippecanoe (no instalado, requiere GeoJSON intermedio); Overpass (sin agua/costa listas ni esquema estándar); versionar el binario (engorda git en cada actualización).

## Consecuencias

La primera generación descarga ~1,4 GB auxiliares (agua, Natural Earth). Atribución ODbL y OpenMapTiles obligatoria en la UI (M2.2). Actualizar OSM = cambiar la URL fechada y regenerar.
