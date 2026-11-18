import { z } from "zod";

export const LAYER_IDS = [
  "bus",
  "bike",
  "weather",
  "sea",
  "ship",
  "air",
  "plane",
  "train",
] as const;

export const LayerIdSchema = z.enum(LAYER_IDS);
export type LayerId = z.infer<typeof LayerIdSchema>;

/** Capas de móviles (Entity), de estaciones (StationStatus) y de observaciones (Observation). */
export const MOBILE_LAYER_IDS = ["bus", "ship", "plane", "train"] as const;
export const MobileLayerIdSchema = z.enum(MOBILE_LAYER_IDS);
export const OBSERVATION_LAYER_IDS = ["weather", "air", "sea"] as const;
export const ObservationLayerIdSchema = z.enum(OBSERVATION_LAYER_IDS);

/**
 * Tiempo: epoch ms UTC, entero. El mínimo 1e11 (año 1973) rechaza epoch en segundos
 * (hoy ~1.7e9), el error típico al parsear fuentes externas.
 */
export const TimestampSchema = z.number().int().gt(1e11);
