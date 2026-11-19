import type { LayerItem } from "@pulso/schema";
import { SEA_STATION, TIDE_METRIC } from "./station";

export interface TideSample {
  /** UTC epoch ms. */
  ts: number;
  /** Nivel, m respecto al cero del mareógrafo. */
  value: number;
}

/** Rango físico aceptado (el mismo que el adaptador, M5.1a). */
const MIN_LEVEL = -5;
const MAX_LEVEL = 15;

export const HISTORY_MAX_AGE_MS = 6 * 3_600_000;
export const HISTORY_MAX_SAMPLES = 90;

/** La lectura de nivel de un lote de observaciones, o `undefined` si no hay una válida. */
export function readTide(items: Iterable<LayerItem>): TideSample | undefined {
  for (const item of items) {
    if (!("metric" in item)) continue;
    if (item.stationId !== SEA_STATION.stationId || item.metric !== TIDE_METRIC) continue;
    if (item.unit !== "m") continue;
    if (!Number.isFinite(item.value) || item.value < MIN_LEVEL || item.value > MAX_LEVEL) continue;
    if (!Number.isFinite(item.ts) || item.ts <= 0) continue;
    return { ts: item.ts, value: item.value };
  }
  return undefined;
}

/**
 * Lecturas de la sesión (el almacén solo guarda la última). Orden creciente y sin repetidos por
 * `ts`; una lectura más antigua que la última se ignora (dato reordenado).
 */
export class TideHistory {
  private list: TideSample[] = [];

  get samples(): readonly TideSample[] {
    return this.list;
  }

  get latest(): TideSample | undefined {
    return this.list[this.list.length - 1];
  }

  /** Devuelve si la lectura se guardó. */
  record(sample: TideSample): boolean {
    const last = this.latest;
    if (last && sample.ts <= last.ts) {
      if (sample.ts === last.ts && sample.value !== last.value) {
        this.list[this.list.length - 1] = sample; // corrección del mismo instante
        return true;
      }
      return false;
    }
    this.list.push(sample);
    const oldest = sample.ts - HISTORY_MAX_AGE_MS;
    let drop = 0;
    while (drop < this.list.length - 1 && (this.list[drop] as TideSample).ts < oldest) drop++;
    if (this.list.length - drop > HISTORY_MAX_SAMPLES)
      drop = this.list.length - HISTORY_MAX_SAMPLES;
    if (drop > 0) this.list = this.list.slice(drop);
    return true;
  }

  clear(): void {
    this.list = [];
  }
}
