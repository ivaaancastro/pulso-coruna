# apps/web

PWA de Pulso A Coruña (Vite + TypeScript, sin framework). M2.4: tokens de diseño y shell de UI sobre un contenedor `#map` vacío (el mapa llega en M2.2).

```bash
pnpm --filter @pulso/web dev      # http://localhost:5173
pnpm --filter @pulso/web test
```

- Tokens: `src/styles/tokens.css` (copia de `docs/design/tokens.md`).
- Cadenas: `src/i18n/` (es-ES por defecto, gl, en). Ningún texto fijo en componentes.
- Tiempo interno en UTC epoch ms; `Europe/Madrid` solo al mostrar (`src/time/format.ts`).
- Tipografía Archivo (OFL 1.1) autoalojada en `public/fonts/` (con `OFL.txt`). Fichero: `@fontsource-variable/archivo` 5.3.0, subset latín con ejes `wght` y `wdth` (~90 KB; subsetear más queda para M2.5).

## PWA (M2.6, ADR-0012)

- `public/manifest.webmanifest` + iconos en `public/icons/`. Fuente: `icons/icon.svg`; regenerar PNG con `pnpm --filter @pulso/web icons` (sharp, solo dev).
- Service worker propio: lógica pura en `src/pwa/sw-logic.ts` (testeada), pegamento en `src/pwa/sw.ts`, empaquetado a `dist/sw.js` por `vite/sw-plugin.mjs` (precaché versionada por hash). Solo se registra en build de producción (`src/pwa/register.ts`, carga diferida).
- Teselas `/tiles/coruna.pmtiles`: se cachea el fichero completo (la Cache API no guarda 206) y las peticiones `Range` se sirven recortando; `/api/` y `/ws` nunca se cachean.
- Probar: `pnpm --filter @pulso/web build && pnpm --filter @pulso/web preview`, y en Chrome DevTools > Application.
