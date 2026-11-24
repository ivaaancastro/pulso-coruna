# ADR-0031: teselas hasta z16 en el casco urbano

Estado: aceptada. Fecha: 2026-11-24. Amplía ADR-0009 y ADR-0013.

- **Contexto:** con teselas a z14 y mapa hasta z17, el zoom cercano se veía borroso (sobremuestreo ×8).
- **Decisión:** `build.sh` usa `--maxzoom=16`, pero solo dentro de `DETAIL_BOUNDS` (`-8.48,43.31,-8.34,43.40`); fuera, `CorunaTiles.java` limita las features a z14. Se excluyen las capas que el estilo no usa (`poi`, `housenumber`, `mountain_peak`, `aerodrome_label`, `aeroway`, `boundary`). Alturas del Catastro intactas (z16: 96,3 % no por defecto en el casco).
- **Medido:** antes 8,04 MB (z0-14); z16 en todo el bbox 20,8 MiB (supera el límite de 15); z16 solo en el casco y sin capas sin uso **11,23 MB (10,7 MiB)**, build ~1 min con las descargas ya en caché. Primer fotograma sin cambio (≈1,8 s escritorio, ≈0,8 s móvil, SwiftShader).
- **Consecuencias:** el service worker precarga el fichero entero: +3,2 MB por primera visita; `TILES_CACHE` pasa a `tiles-v3` para renovar el `.pmtiles` cacheado. Sin cambios en estilo ni `BOUNDS` (la fuente toma maxzoom de la cabecera PMTiles).
