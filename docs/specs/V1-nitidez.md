# V1-nitidez — render nítido del mapa

Prioridad de la v1: que el mapa se vea muy nítido. Sin cambiar la dirección de arte («Faro»).

## Qué cambia

- **MSAA** en el lienzo de MapLibre (`canvasContextAttributes.antialias: true`) y explícito en deck.gl (`deviceProps.webgl.antialias`).
- **DPR coherente**: `src/map/pixel-ratio.ts` (`pixelRatioFor`) da la misma densidad al mapa y a deck.gl (`useDevicePixels`). Tope por nivel de auto-quality: high 3, medium 2, low 1,5 (antes mapa ≤2 y deck.gl sin tope). `live/start.ts` aplica `map.setPixelRatio` y `useDevicePixels` en cada cambio de nivel (la degradación <45 fps sigue intacta: no se tocó `monitor.ts`).
- **Tamaños en px** de iconos, halos y estelas de deck.gl: usan `sizeUnits: "pixels"`/anchos en px CSS, que deck.gl multiplica por el DPR; no requieren cambios.
- **Estilo**: carreteras con anchos mínimos mayores y un tramo intermedio en z14–15 (minor 0,6→1→3 px; mid 0,6→1,4→4; major 0,8→1,6→5,4), halo de etiquetas 1,5→2 px (blur 0,4) y edificios 3D opacos (0,94→1: sin transparencias entre volúmenes).
- **Glifos**: sin cambios. `Archivo Regular` 0-255 cubre todo el latín-1 (á é í ó ú ü ñ ç ¿ ¡ « »…) y 8192-8447 la puntuación tipográfica. Comprobado en el PBF y en las 1111 entidades con nombre de las teselas cargadas: solo aparecen ñíáóéúÁÉ, ningún carácter fuera de rango. No hacen falta rangos nuevos ni ADR.

## Números (Chrome estable, 390×844, DPR 1, `vite preview`)

| Perfil                                     | Antes (avg / p5) | Después (avg / p5) |
| ------------------------------------------ | ---------------- | ------------------ |
| `pnpm perf:e2e` (SwiftShader, sin GPU)     | 52,8 / 59,5      | 47,2 / 59,5        |
| `PERF_FPS_PROFILE=gpu` (GPU de escritorio) | 60,0 / 59,9      | 60,0 / 59,5        |

SwiftShader (CPU) paga el MSAA; con GPU real el fps no cae. Bundle diferido 549,4 → 549,7 KB (< 565), inicial 11,2 KB.
Verificado en página: a DPR 3 ambos lienzos son 1170×2532 (390 css ×3) con `antialias: true`.

## Capturas

`docs/design/capturas/v1-render-{esc,mov}-{dia,noche}-dpr{1,2}-z{14..17}.png` (1440×900 y 390×844, dev:mock).

## Sin verificar

Dispositivos 3× reales (fps con DPR 3 y MSAA en móvil; M8.3 sigue pendiente), fps con DPR 2/3 en GPU real.
