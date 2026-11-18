# ADR-0010: librería `pmtiles` para leer las teselas propias en el navegador

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

M2.2 sirve `coruna.pmtiles` (ADR-0009) como fichero estático con `Range`. MapLibre no lee el formato por sí solo; hace falta el protocolo `pmtiles://`.

## Decisión

`pmtiles` 4.5.0 (exacta, BSD-3-Clause, única dependencia `fflate`) de Protomaps, registrada con `maplibregl.addProtocol("pmtiles", new Protocol().tile)` dentro del chunk diferido del mapa. Peticiones solo a nuestro origen. `maplibre-gl` 5.24.1 según ADR-0007.

## Alternativas

Convertir a teselas `z/x/y` en disco (miles de ficheros, despliegue más pesado); tile server propio (proceso extra en el VPS para 7 MB).

## Consecuencias

Una dependencia pequeña en el chunk del mapa (no en el JS inicial). Actualizar a 5.x exigirá revisar el API del protocolo. Los glifos se generan fuera del repo con `fontnik` (script `apps/web/scripts/build-glyphs.mjs`, no es dependencia).
