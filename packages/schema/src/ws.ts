import { z } from "zod";
import { EntitySchema } from "./entity.js";
import { LayerIdSchema, OBSERVATION_LAYER_IDS, TimestampSchema, type LayerId } from "./layers.js";
import { ObservationSchema } from "./observation.js";
import { StationStatusSchema } from "./station.js";

/** Versión del protocolo WS. Cambios incompatibles → v2. */
export const WS_VERSION = 1 as const;

/** Elemento transportable. Los esquemas son estrictos, así la unión no descarta claves. */
export const LayerItemSchema = z.union([EntitySchema, StationStatusSchema, ObservationSchema]);
export type LayerItem = z.infer<typeof LayerItemSchema>;

/** Cada capa transporta un único tipo de elemento. */
const itemSchemaForLayer = (layer: LayerId) => {
  if (layer === "bike") return StationStatusSchema;
  if ((OBSERVATION_LAYER_IDS as readonly string[]).includes(layer)) return ObservationSchema;
  return EntitySchema;
};

const checkItems = (
  layer: LayerId,
  items: readonly unknown[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void => {
  const schema = itemSchemaForLayer(layer);
  items.forEach((item, i) => {
    if (!schema.safeParse(item).success) {
      ctx.addIssue({
        code: "custom",
        path: [...path, i],
        message: `el elemento no corresponde al tipo de la capa ${layer}`,
      });
    }
  });
};

export const SnapshotMessageSchema = z
  .strictObject({
    v: z.literal(WS_VERSION),
    type: z.literal("snapshot"),
    ts: TimestampSchema,
    layers: z.partialRecord(LayerIdSchema, z.array(LayerItemSchema)),
  })
  .superRefine((m, ctx) => {
    for (const [layer, items] of Object.entries(m.layers)) {
      checkItems(layer as LayerId, items, ["layers", layer], ctx);
    }
  });
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;

export const DeltaMessageSchema = z
  .strictObject({
    v: z.literal(WS_VERSION),
    type: z.literal("delta"),
    ts: TimestampSchema,
    layer: LayerIdSchema,
    upserts: z.array(LayerItemSchema),
    // Clave de identidad: `id` (Entity, StationStatus) o `stationId:metric` (Observation).
    removes: z.array(z.string().min(1)),
  })
  .superRefine((m, ctx) => {
    checkItems(m.layer, m.upserts, ["upserts"], ctx);
  });
export type DeltaMessage = z.infer<typeof DeltaMessageSchema>;

export const WsMessageSchema = z.discriminatedUnion("type", [
  SnapshotMessageSchema,
  DeltaMessageSchema,
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
