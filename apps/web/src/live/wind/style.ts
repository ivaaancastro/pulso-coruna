import { paletteAt } from "../../map/palette";

/** `--pulso-wind` (docs/design/tokens.md). */
export const WIND_RGB: readonly [number, number, number] = [0xc9, 0xdc, 0xf5];
/** Trazo fino, sin relleno (direccion.md). */
export const WIND_WIDTH_PX = 1.4;
const ALPHA_NIGHT = 0.85;
const ALPHA_DAY = 1;

export interface WindStyle {
  rgb: readonly [number, number, number];
  /** Opacidad máxima de la cabeza del trazo. */
  alpha: number;
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Opacidad según la luz (elevación solar de `map/palette.ts`): el mapa de día es más claro. */
export function alphaForElevation(elevation: number): number {
  return ALPHA_NIGHT + (ALPHA_DAY - ALPHA_NIGHT) * smooth((elevation + 6) / 18);
}

let cacheKey = -1;
let cacheAlpha = ALPHA_NIGHT;

/** La luz cambia despacio: se recalcula como mucho cada 30 s de reloj de la app. */
export function windStyle(now: number): WindStyle {
  const key = Math.floor(now / 30_000);
  if (key !== cacheKey) {
    cacheKey = key;
    cacheAlpha = alphaForElevation(paletteAt(now).sunElevation);
  }
  return { rgb: WIND_RGB, alpha: cacheAlpha };
}
