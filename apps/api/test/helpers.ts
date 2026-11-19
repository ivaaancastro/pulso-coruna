import type { Entity, LayerId, LayerItem, Observation, StationStatus } from "@pulso/schema";
import { LAYER_IDS } from "@pulso/schema";
import type { ApiConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import type { DataSource, Latest, SourceHealthRow } from "../src/db.js";

export const T0 = 1_760_000_000_000;

export const bus = (id: string, lon = -8.4, over: Partial<Entity> = {}): Entity => ({
  id,
  layer: "bus",
  lon,
  lat: 43.36,
  ts: T0,
  ...over,
});
export const station = (
  id: string,
  bikes = 5,
  over: Partial<StationStatus> = {},
): StationStatus => ({
  id,
  layer: "bike",
  lon: -8.41,
  lat: 43.37,
  bikes,
  docks: 10,
  ts: T0,
  ...over,
});
export const wind = (
  stationId: string,
  value = 4,
  over: Partial<Observation> = {},
): Observation => ({
  stationId,
  layer: "weather",
  metric: "wind_speed",
  value,
  unit: "m/s",
  ts: T0,
  ...over,
});

export const emptyLayers = (): Record<LayerId, LayerItem[]> =>
  Object.fromEntries(LAYER_IDS.map((l) => [l, [] as LayerItem[]])) as Record<LayerId, LayerItem[]>;

/** Fuente de datos en memoria: se cambia `layers` entre sondeos. */
export class FakeSource implements DataSource {
  layers = emptyLayers();
  health: SourceHealthRow[] = [];
  freshness: Partial<Record<LayerId, number>> = {};
  failing = false;
  latestCalls = 0;
  ts = T0;

  latest(): Promise<Latest> {
    this.latestCalls++;
    if (this.failing) return Promise.reject(new Error("BD caída"));
    const layers = Object.fromEntries(
      LAYER_IDS.map((l) => [l, [...this.layers[l]]]),
    ) as Latest["layers"];
    return Promise.resolve({ ts: this.ts, layers });
  }
  sourceHealth(): Promise<SourceHealthRow[]> {
    return this.failing ? Promise.reject(new Error("BD caída")) : Promise.resolve(this.health);
  }
  layerFreshness(): Promise<Partial<Record<LayerId, number>>> {
    return Promise.resolve(this.freshness);
  }
  ping(): Promise<number> {
    return this.failing ? Promise.reject(new Error("BD caída")) : Promise.resolve(1);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export const testConfig = (over: Partial<ApiConfig> = {}): ApiConfig => ({
  ...loadConfig({ DATABASE_URL: "postgres://x@localhost/x", API_LOG_LEVEL: "silent" }),
  pollMs: 100,
  wsPingMs: 50,
  ...over,
});

/** Espera a que se cumpla una condición (sondeo corto). */
export async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: tiempo agotado");
    await new Promise((r) => setTimeout(r, 10));
  }
}
