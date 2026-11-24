import type { QualityLevel } from "../live/quality/monitor";

/**
 * Densidad de píxeles del mapa y de deck.gl (misma para ambos lienzos: halos e iconos de deck.gl
 * quedan alineados con el mapa). En pantallas 3× el nivel «high» llega a 3 (texto y trazos nítidos);
 * el auto-quality (<45 fps) baja a 2 y luego a 1,5. Nunca por debajo de 1 ni por encima del dpr real.
 */
export const PIXEL_RATIO_CAP: Record<QualityLevel, number> = { high: 3, medium: 2, low: 1.5 };

export function pixelRatioFor(dpr: number, level: QualityLevel = "high"): number {
  const real = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.max(1, Math.min(real, PIXEL_RATIO_CAP[level]));
}
