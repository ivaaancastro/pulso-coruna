# apps/web

PWA de Pulso A Coruña (Vite + TypeScript, sin framework). M2.4: tokens de diseño y shell de UI. M2.2: mapa base propio (MapLibre GL 5.24.1 + `pmtiles`) dentro de `#map`.

```bash
pnpm --filter @pulso/web tiles:copy   # una vez: copia infra/tiles/.work/coruna.pmtiles a public/tiles/
pnpm --filter @pulso/web dev          # http://localhost:5173
pnpm --filter @pulso/web test
pnpm perf                         # desde la raíz: bundle + Lighthouse CI + fps/terceros (docs/TOOLING.md, ADR 0011)
```

- Tokens: `src/styles/tokens.css` (copia de `docs/design/tokens.md`).
- Cadenas: `src/i18n/` (es-ES por defecto, gl, en). Ningún texto fijo en componentes.
- Tiempo interno en UTC epoch ms; `Europe/Madrid` solo al mostrar (`src/time/format.ts`).
- Tipografía Archivo (OFL 1.1) autoalojada en `public/fonts/` (con `OFL.txt`). Fichero: `@fontsource-variable/archivo` 5.3.0, subset es/gl/en (latín + Latin-1, sin latin-ext) con ejes `wght` 300–600 y `wdth` 90–125 (rango usado en el diseño), 39,8 KB. Se regenera con `scripts/subset-font.sh`.

## Mapa base (M2.2)

- `src/map/map.ts` es el chunk diferido (import dinámico desde `main.ts`): MapLibre + `pmtiles`. El JS inicial no lo incluye.
- `src/map/style.ts`: estilo propio «Faro» sobre las capas OpenMapTiles (sin `poi`, `housenumber`, etc.). Edificios extruidos con `render_height`/`render_min_height` desde z14 (en z13 la tesela no trae alturas: se pintan planos).
- `src/map/palette.ts` + `sun.ts`: paleta noche/amanecer/día/atardecer por elevación solar real en A Coruña (UTC; la zona `Europe/Madrid` solo aparece al mostrar la hora). La luz de los edificios (`light`) sigue al sol; se reevalúa cada minuto.
- Dev: `?t=2026-11-18T22:30:00Z` (ISO con zona o epoch ms) fija la hora para revisar noche/día; se ignora en producción. `window.__pulsoMap` expone el mapa solo en dev.
- `performance.mark('map:first-frame')` se marca tras el evento `load` del mapa (primer fotograma completo).
- Teselas: `public/tiles/coruna.pmtiles` no se versiona (`.gitignore`); `tiles:copy` lo copia desde `infra/tiles/.work/` (genéralo antes con `infra/tiles/build.sh`) o de la ruta que pases como argumento.
- Glifos y sprites propios, cero peticiones a terceros: `public/glyphs/Archivo Regular/{0-255,8192-8447}.pbf` (SDF generados desde la Archivo ya alojada; sin sprites porque el estilo no usa iconos). Para regenerarlos o añadir rangos/pesos:

  ```bash
  TMP=$(mktemp -d) && npm i --prefix "$TMP" fontnik wawoff2
  NODE_PATH="$TMP/node_modules" node apps/web/scripts/build-glyphs.mjs
  ```

  (herramientas temporales, no son dependencias del proyecto). El nombre de la pila (`Archivo Regular`) es el de `FONT` en `style.ts`.

- Atribución visible `© OpenMapTiles © OpenStreetMap contributors` con el control de MapLibre (`src/map/attribution.css`).

## PWA (M2.6, ADR-0012)

- `public/manifest.webmanifest` + iconos en `public/icons/`. Fuente: `icons/icon.svg`; regenerar PNG con `pnpm --filter @pulso/web icons` (sharp, solo dev).
- Service worker propio: lógica pura en `src/pwa/sw-logic.ts` (testeada), pegamento en `src/pwa/sw.ts`, empaquetado a `dist/sw.js` por `vite/sw-plugin.mjs` (precaché versionada por hash). Solo se registra en build de producción (`src/pwa/register.ts`, carga diferida).
- Teselas `/tiles/coruna.pmtiles`: se cachea el fichero completo (la Cache API no guarda 206) y las peticiones `Range` se sirven recortando; `/api/` y `/ws` nunca se cachean.
- Probar: `pnpm --filter @pulso/web build && pnpm --filter @pulso/web preview`, y en Chrome DevTools > Application.
