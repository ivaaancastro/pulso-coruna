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

/** Tiempo: epoch ms UTC, entero positivo (los segundos no se distinguen por valor; se valida solo tipo y signo). */
export const TimestampSchema = z.number().int().positive();
