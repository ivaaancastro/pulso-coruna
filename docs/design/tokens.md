# Tokens de diseño

> Estado: **propuesta, pendiente de aprobación humana** (M1.6). M2.4 los traslada a CSS (`:root`) y a un módulo TS para las capas de deck.gl. Justificación en `direccion.md`.

Convención: nombres `--pulso-*`. Los colores de capa se exportan también como `[r, g, b]` para deck.gl. Tema único (nocturno); no hay modo claro.

## Colores

```css
:root {
  /* base */
  --pulso-bg: #05080e;
  --pulso-land: #0a0f19;
  --pulso-water: #0b2236;
  --pulso-water-deep: #06131f;
  --pulso-coast: #1e3a55;
  --pulso-building: #1a2438;
  --pulso-building-side: #111827;
  --pulso-surface: #0c1220;
  --pulso-surface-overlay: #141c2e;

  /* texto */
  --pulso-text: #e8eef7; /* 16,03:1 sobre surface */
  --pulso-text-muted: #8e9bb0; /* 6,65:1 */
  --pulso-text-subtle: #7a88a4; /* 5,24:1 */

  /* bordes */
  --pulso-border-control: #5a6a88; /* 3,43:1, para controles */
  --pulso-border-hairline: #243049; /* decorativo */

  /* estados */
  --pulso-focus: #f5f1e4;
  --pulso-warn: #ffb020;
  --pulso-error: #ff6b6b;

  /* capas */
  --pulso-bus: #ffc23d;
  --pulso-bike: #6be8a4;
  --pulso-wind: #c9dcf5;
  --pulso-sea: #22c7d9;
  --pulso-ship: #ff7a59;
  --pulso-air: #a78bfa;
  --pulso-plane: #f5f1e4;
  --pulso-train: #f45cd8;
  --pulso-layer-muted-opacity: 0.35; /* capa sin dato */
}
```

Forma y movimiento por capa (no solo color): ver tabla de `direccion.md`.

## Tipografía

```css
:root {
  --pulso-font: "Archivo", system-ui, sans-serif; /* variable, autoalojada, OFL 1.1 */
  --pulso-tabular: tabular-nums;

  --pulso-text-display: 64px; /* >= 1024px: 120px */
  --pulso-text-title: 28px; /* >= 1024px: 40px */
  --pulso-text-body: 16px;
  --pulso-text-label: 13px;

  --pulso-leading-display: 1;
  --pulso-leading-body: 1.5;
}
```

Variaciones: `display` `font-weight: 300; font-stretch: 125%`; `title` 400 / 110 %; `body` 400 / 100 %; `label` 500 / 90 %. Medida máxima de texto: `60ch`. Hora e índice con `font-variant-numeric: tabular-nums` y ancho fijo en `ch`.

## Espaciado (base 4 px)

`--pulso-space-1` 4 px · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 72.
Margen de pantalla (gutter): 16 px móvil, 32 px escritorio. Respeta `env(safe-area-inset-*)`. Objetivo táctil mínimo: 44×44 px.

## Radios

`--pulso-radius-0` 0 (mapa, línea de tiempo) · `-1` 6 px (controles y chips) · `-2` 14 px (menús y diálogos) · `-pill` 999 px (selector de modo). Sin sombras: la separación se hace con color de `surface`.

## Movimiento

```css
:root {
  --pulso-dur-instant: 80ms;
  --pulso-dur-fast: 160ms;
  --pulso-dur-base: 280ms;
  --pulso-dur-slow: 600ms;
  --pulso-dur-camera: 2200ms;
  --pulso-dur-intro: 3800ms;

  --pulso-ease-drone: cubic-bezier(0.22, 0.61, 0.36, 1);
  --pulso-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --pulso-ease-in: cubic-bezier(0.5, 0, 0.75, 0);
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --pulso-dur-fast: 80ms;
    --pulso-dur-base: 80ms;
    --pulso-dur-slow: 80ms;
    --pulso-dur-camera: 0ms;
    --pulso-dur-intro: 200ms;
  }
}
```

## Foco y accesibilidad

Foco visible: contorno 2 px `--pulso-focus` con desplazamiento 2 px, en todos los controles. Nada transmite información solo por color. Textos de interfaz, en gallego/castellano, desde el módulo de cadenas.

## Postprocesado y calidad

`quality: low | medium | high`. Bloom solo en `high` y apagado por defecto en v1 (ver `direccion.md`). Halo ≤ 2000 instancias. Degradar un nivel si < 45 fps durante 3 s.

## Para aprobar (checklist humano)

- [ ] Concepto «Faro» y la prioridad de «solo brilla el dato».
- [ ] Paleta (fondo, agua, capas), en especial `train` `#F45CD8` frente a `sea` `#22C7D9` (ΔE 6,3 en deuteranopía, mitigado con forma y leyenda).
- [ ] Tipografía Archivo (OFL 1.1) autoalojada; confirmar el texto literal de licencia al descargar.
- [ ] Sin bloom por defecto en v1.
- [ ] Guiones de intro (≤ 4 s) y demo de 15 s, y mensajes cortos.
- [ ] Haz de la Torre de Hércules como firma visual.
