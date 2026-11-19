import type { LayerId, LayerItem } from "@pulso/schema";
import type { LayerFreshness } from "./types";

/** Clave de identidad: `id` (Entity, StationStatus) o `stationId:metric` (Observation). */
export function itemKey(item: LayerItem): string {
  return "id" in item ? item.id : `${item.stationId}:${item.metric}`;
}

export interface AppliedDelta {
  upserts: LayerItem[];
  removes: string[];
}

const EMPTY: ReadonlyMap<string, LayerItem> = new Map();

/**
 * Almacén por capa. Sin dependencias del navegador: lo usa el worker (autoritativo) y el hilo
 * principal (espejo para lectura de las capas deck.gl, selección, etc.).
 */
export class LayerStore {
  private readonly data = new Map<LayerId, Map<string, LayerItem>>();
  private readonly fresh = new Map<LayerId, LayerFreshness>();

  get(layer: LayerId): ReadonlyMap<string, LayerItem> {
    return this.data.get(layer) ?? EMPTY;
  }

  freshness(layer: LayerId): LayerFreshness | undefined {
    return this.fresh.get(layer);
  }

  /** Capas que alguna vez tuvieron datos o un mensaje. */
  layers(): LayerId[] {
    return [...new Set([...this.data.keys(), ...this.fresh.keys()])];
  }

  /**
   * Sustituye la capa entera (snapshot): lo que no viene, se va. Pero un elemento nunca retrocede:
   * si ya guardamos uno con `ts` más reciente que el del snapshot (snapshot atrasado, réplica con
   * la BD por detrás), se conserva el nuestro. Devuelve los elementos que han quedado.
   */
  replace(layer: LayerId, items: readonly LayerItem[], receivedAt: number): LayerItem[] {
    const prevMap = this.data.get(layer);
    const map = new Map<string, LayerItem>();
    for (const item of items) {
      const key = itemKey(item);
      const prev = prevMap?.get(key);
      map.set(key, prev && prev.ts > item.ts ? prev : item);
    }
    this.data.set(layer, map);
    const kept = [...map.values()];
    this.touch(layer, kept, receivedAt);
    return kept;
  }

  /** Olvida todo, incluida la frescura (reproducción: el instante retrocedió o saltó). */
  reset(): void {
    this.data.clear();
    this.fresh.clear();
  }

  /** Vacía una capa sin tocar su frescura (la capa no vino en el snapshot). */
  clear(layer: LayerId): void {
    this.data.get(layer)?.clear();
  }

  /**
   * Aplica un delta. Un upsert con `ts` anterior al ya guardado se ignora (dato viejo o
   * reordenado). Devuelve lo realmente aplicado.
   */
  apply(
    layer: LayerId,
    upserts: readonly LayerItem[],
    removes: readonly string[],
    receivedAt: number,
  ): AppliedDelta {
    let map = this.data.get(layer);
    if (!map) {
      map = new Map();
      this.data.set(layer, map);
    }
    const acceptedUpserts: LayerItem[] = [];
    for (const item of upserts) {
      const key = itemKey(item);
      const prev = map.get(key);
      if (prev && item.ts < prev.ts) continue;
      map.set(key, item);
      acceptedUpserts.push(item);
    }
    const acceptedRemoves: string[] = [];
    for (const key of removes) {
      if (map.delete(key)) acceptedRemoves.push(key);
    }
    this.touch(layer, upserts, receivedAt);
    return { upserts: acceptedUpserts, removes: acceptedRemoves };
  }

  private touch(layer: LayerId, items: readonly LayerItem[], receivedAt: number): void {
    let dataTs = this.fresh.get(layer)?.dataTs ?? 0;
    for (const item of items) if (item.ts > dataTs) dataTs = item.ts;
    this.fresh.set(layer, { receivedAt, dataTs });
  }
}
