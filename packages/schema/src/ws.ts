import { z } from "zod";
import { EntitySchema } from "./entity.js";
import { LayerIdSchema, TimestampSchema } from "./layers.js";
import { ObservationSchema } from "./observation.js";
import { StationStatusSchema } from "./station.js";

/** Versión del protocolo WS. Cambios incompatibles → v2. */
export const WS_VERSION = 1 as const;

/** Elemento transportable. Los esquemas son estrictos, así la unión no descarta claves. */
export const LayerItemSchema = z.union([EntitySchema, StationStatusSchema, ObservationSchema]);
export type LayerItem = z.infer<typeof LayerItemSchema>;

export const SnapshotMessageSchema = z.strictObject({
  v: z.literal(WS_VERSION),
  type: z.literal("snapshot"),
  ts: TimestampSchema,
  layers: z.partialRecord(LayerIdSchema, z.array(LayerItemSchema)),
});
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;

export const DeltaMessageSchema = z.strictObject({
  v: z.literal(WS_VERSION),
  type: z.literal("delta"),
  ts: TimestampSchema,
  layer: LayerIdSchema,
  upserts: z.array(LayerItemSchema),
  removes: z.array(z.string().min(1)), // ids
});
export type DeltaMessage = z.infer<typeof DeltaMessageSchema>;

export const WsMessageSchema = z.discriminatedUnion("type", [
  SnapshotMessageSchema,
  DeltaMessageSchema,
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
