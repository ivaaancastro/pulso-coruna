/** Colores y tamaños de la capa de aviones (tokens de docs/design/tokens.md). */
export type Rgb = readonly [number, number, number];

/** `--pulso-plane` #F5F1E4. */
export const PLANE_RGB: Rgb = [245, 241, 228];
/** `--pulso-focus` #F5F1E4 (igual que `plane`; el aro de selección se distingue por forma). */
export const FOCUS_RGB: Rgb = [245, 241, 228];

export const SIZE_MIN = 22;
export const SIZE_MAX = 30;
/** Altitud a partir de la cual el tamaño es el máximo, m. */
export const ALT_FULL_M = 10_000;
export const GROUND_SIZE = 16;
/** Opacidad de un avión en tierra (discreto; no depende solo del color: también es más pequeño y sin traza). */
export const GROUND_ALPHA = 0.45;
/** Radio de la zona de toque, px (44 px de diámetro). */
export const HIT_RADIUS = 22;
export const SELECT_RADIUS = 20;

/** Tamaño del icono en px: sutil con la altitud; en tierra, el menor. */
export function iconSize(altM: number | undefined, onGround: boolean): number {
  if (onGround) return GROUND_SIZE;
  const k = Math.min(1, Math.max(0, (altM ?? 0) / ALT_FULL_M));
  return SIZE_MIN + (SIZE_MAX - SIZE_MIN) * k;
}

/** Alfa 0–255 del icono: opacidad por edad × discreción en tierra. */
export function iconAlpha(onGround: boolean, opacity: number): number {
  return Math.round(255 * opacity * (onGround ? GROUND_ALPHA : 1));
}
