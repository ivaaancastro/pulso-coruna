# ADR-0014: lector de ZIP y CSV propios para el adaptador GTFS

- Fecha: 2026-11-18
- Estado: aceptada

## Contexto

M3.1 descarga un zip GTFS (3,7 MB; 45 MB descomprimido) y lee CSV con comillas y CRLF. Añadir una dependencia exige ADR.

## Decisión

Sin dependencias nuevas: lector de ZIP mínimo (`packages/adapters/gtfs/zip.ts`, métodos stored/deflate, sin ZIP64) que descomprime con `DecompressionStream("deflate-raw")` (estándar web, Node ≥ 18), y parser CSV RFC 4180 propio (`csv.ts`). `fetch` devuelve los archivos como texto y `parse` es síncrono y puro.

## Alternativas

`fflate` + `papaparse`: más robustas, pero dos dependencias para ~150 líneas verificadas contra el feed real.

## Consecuencias

Si la fuente pasara a ZIP64 o cifrado, `unzip` lanza error explícito y habría que adoptar `fflate` (nuevo ADR). Tope de 128 MB por archivo contra zips-bomba.
