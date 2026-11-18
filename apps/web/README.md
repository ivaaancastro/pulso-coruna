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
