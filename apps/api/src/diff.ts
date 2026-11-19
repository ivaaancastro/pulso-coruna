import {
  LAYER_IDS,
  OBSERVATION_LAYER_IDS,
  observationKey,
  type LayerId,
  type LayerItem,
  type Observation,
} from "@pulso/schema";

const isObservationLayer = (layer: LayerId): boolean =>
  (OBSERVATION_LAYER_IDS as readonly string[]).includes(layer);

/** Clave de identidad de un elemento de la capa: `id` o `stationId:metric` (observaciones). */
export const itemKey = (layer: LayerId, item: LayerItem): string =>
  isObservationLayer(layer) ? observationKey(item as Observation) : (item as { id: string }).id;

/** Estado conocido de una capa: clave → elemento y su firma serializada (para comparar rápido). */
export type LayerState = Map<string, { item: LayerItem; sig: string }>;

export interface LayerDiff {
  upserts: LayerItem[];
  removes: string[];
  next: LayerState;
}

/**
 * Diferencia entre el estado anterior de una capa y la lista completa actual. Puro.
 * Upsert = clave nueva o contenido distinto; remove = clave que ya no está.
 */
export function diffLayer(
  layer: LayerId,
  prev: LayerState,
  current: readonly LayerItem[],
): LayerDiff {
  const next: LayerState = new Map();
  const upserts: LayerItem[] = [];
  for (const item of current) {
    const key = itemKey(layer, item);
    const sig = JSON.stringify(item);
    next.set(key, { item, sig });
    if (prev.get(key)?.sig !== sig) upserts.push(item);
  }
  const removes: string[] = [];
  for (const key of prev.keys()) if (!next.has(key)) removes.push(key);
  return { upserts, removes, next };
}

export const emptyState = (): Record<LayerId, LayerState> =>
  Object.fromEntries(LAYER_IDS.map((l) => [l, new Map() as LayerState])) as Record<
    LayerId,
    LayerState
  >;

export const stateItems = (state: LayerState): LayerItem[] =>
  Array.from(state.values(), (v) => v.item);
