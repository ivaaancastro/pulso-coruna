import { z } from "zod";
import { MobileLayerIdSchema, TimestampSchema } from "./layers.js";

/** Móviles: bus, barco, avión, tren. Identidad: `id`. Estricto: claves desconocidas se rechazan. */
export const EntitySchema = z.strictObject({
  id: z.string().min(1), // estable dentro de la fuente
  layer: MobileLayerIdSchema,
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  heading: z.number().min(0).max(360).optional(), // grados, 0 = norte
  speed: z.number().min(0).optional(), // m/s
  ts: TimestampSchema,
  meta: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type Entity = z.infer<typeof EntitySchema>;
