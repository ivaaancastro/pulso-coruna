import { z } from "zod";
import { TimestampSchema } from "./layers.js";

/** Meteo, aire, mar. */
export const ObservationSchema = z.strictObject({
  stationId: z.string().min(1),
  layer: z.enum(["weather", "air", "sea"]),
  metric: z.string().min(1), // 'wind_speed', 'no2', 'tide_level'…
  value: z.number(), // zod 4 rechaza NaN e Infinity
  unit: z.string(),
  ts: TimestampSchema,
});
export type Observation = z.infer<typeof ObservationSchema>;
