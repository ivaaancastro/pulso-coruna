/** `--pulso-sea` #22C7D9 (docs/design/tokens.md). */
export const SEA_RGB: readonly [number, number, number] = [0x22, 0xc7, 0xd9];
/** `--pulso-focus` #F5F1E4. */
export const FOCUS_RGB: readonly [number, number, number] = [0xf5, 0xf1, 0xe4];

/** Radio exterior de la lámina de agua, m: crece de bajamar a pleamar. */
export const HALO_MIN_RADIUS_M = 250;
export const HALO_RANGE_M = 450;
/** Radio de la zona de toque, px (44 px de diámetro). */
export const HIT_RADIUS_PX = 22;
/** Duración de la transición de nivel, ms (`--pulso-dur-camera`). */
export const LEVEL_TRANSITION_MS = 2200;

/** Capas del halo: fracción del radio exterior de cada disco concéntrico. */
const DISC_SCALES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

export interface HaloDisc {
  radius: number;
  /** Alfa 0..255 del disco (se acumulan hacia el centro: halo suave). */
  alpha: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function haloRadius(fraction: number): number {
  return HALO_MIN_RADIUS_M + HALO_RANGE_M * clamp01(fraction);
}

/** Pleamar = halo más ancho y luminoso; bajamar = pequeño y tenue. */
export function haloDiscs(fraction: number): HaloDisc[] {
  const f = clamp01(fraction);
  const outer = haloRadius(f);
  const alpha = Math.round((0.014 + 0.03 * f) * 255);
  return DISC_SCALES.map((s) => ({ radius: outer * s, alpha }));
}

/** Alfa 0..255 del aro de la «línea de nivel», borde exterior del halo. */
export function lineAlpha(fraction: number): number {
  return Math.round((0.45 + 0.4 * clamp01(fraction)) * 255);
}
