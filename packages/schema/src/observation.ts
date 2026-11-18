import { z } from "zod";
import { ObservationLayerIdSchema, TimestampSchema } from "./layers.js";

/** Meteo, aire, mar. Identidad: `stationId:metric` (ver `observationKey`). */
export const ObservationSchema = z.strictObject({
  stationId: z.string().min(1),
  layer: ObservationLayerIdSchema,
  metric: z.string().min(1), // 'wind_speed', 'no2', 'tide_level'…
  value: z.number(), // zod 4 rechaza NaN e Infinity
  unit: z.string(), // vacío permitido: magnitudes adimensionales
  ts: TimestampSchema,
});
export type Observation = z.infer<typeof ObservationSchema>;

/** Clave de identidad de una observación (la usan los `removes` del delta). */
export const observationKey = (o: Pick<Observation, "stationId" | "metric">): string =>
  `${o.stationId}:${o.metric}`;
