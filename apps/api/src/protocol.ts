import {
  LAYER_IDS,
  WS_VERSION,
  type DeltaMessage,
  type LayerId,
  type LayerItem,
  type SnapshotMessage,
} from "@pulso/schema";

const KNOWN = new Set<string>(LAYER_IDS);

export type ParsedLayers = { ok: true; layers: LayerId[] } | { ok: false; error: string };

/**
 * `?layers=bus,bike` → capas únicas en orden de aparición. Sin parámetro = todas.
 * Un valor vacío o con capas desconocidas es un error del cliente (400).
 */
export function parseLayers(raw: unknown): ParsedLayers {
  if (raw === undefined) return { ok: true, layers: [...LAYER_IDS] };
  if (typeof raw !== "string")
    return { ok: false, error: "layers debe ser una lista separada por comas" };
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.every((p) => p === "")) return { ok: false, error: "layers está vacío" };
  const unknown = parts.filter((p) => !KNOWN.has(p));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `capas desconocidas: ${unknown.map((u) => u || "(vacío)").join(", ")}. Válidas: ${LAYER_IDS.join(", ")}`,
    };
  }
  return { ok: true, layers: [...new Set(parts as LayerId[])] };
}

export function snapshotMessage(
  ts: number,
  layers: readonly LayerId[],
  items: Record<LayerId, readonly LayerItem[]>,
): SnapshotMessage {
  const out: SnapshotMessage["layers"] = {};
  for (const l of layers) out[l] = [...items[l]];
  return { v: WS_VERSION, type: "snapshot", ts, layers: out };
}

export function deltaMessage(
  ts: number,
  layer: LayerId,
  upserts: LayerItem[],
  removes: string[],
): DeltaMessage {
  return { v: WS_VERSION, type: "delta", ts, layer, upserts, removes };
}
