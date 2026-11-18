import { z } from "zod";
import { TimestampSchema } from "./layers.js";

/** Estaciones de bicis. Identidad: `id`. */
export const StationStatusSchema = z.strictObject({
  id: z.string().min(1),
  layer: z.literal("bike"),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  bikes: z.number().int().min(0),
  docks: z.number().int().min(0),
  ts: TimestampSchema,
});
export type StationStatus = z.infer<typeof StationStatusSchema>;
