import { TrailConfig, type TrailQuality, type TrailSettings } from "../bus/trail-config";

/**
 * Estela corta de los barcos en movimiento. Navegan más despacio que un bus (≈ 5 m/s), así que la
 * ventana es mayor que la de bus (25 s) para que se vea. En calidad baja no hay estela (M4.7).
 */
export const SHIP_TRAIL_PRESETS: Readonly<Record<TrailQuality, TrailSettings>> = {
  high: { lengthMs: 90_000, sampleMs: 1000, minStepM: 3 },
  medium: { lengthMs: 45_000, sampleMs: 1500, minStepM: 4 },
  low: { lengthMs: 0, sampleMs: 2000, minStepM: 6 },
};

export const shipTrailConfig = new TrailConfig("high", SHIP_TRAIL_PRESETS);
