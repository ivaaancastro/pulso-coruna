import type { Entity, Observation, StationStatus } from "@pulso/schema";
import { silentLogger } from "../src/clock.js";
import type { CycleDeps } from "../src/cycle.js";
import type { IngestAdapter, Row, SourceHealth, Store, ValidRows } from "../src/types.js";
import { FakeClock } from "./fake-clock.js";

export const T0 = 1_760_000_000_000;

export const bus = (id: string, ts = T0): Entity => ({
  id,
  layer: "bus",
  lon: -8.4,
  lat: 43.37,
  ts,
});
export const station = (id: string, ts = T0): StationStatus => ({
  id,
  layer: "bike",
  lon: -8.4,
  lat: 43.37,
  bikes: 3,
  docks: 7,
  ts,
});
export const wind = (stationId: string, ts = T0): Observation => ({
  stationId,
  layer: "weather",
  metric: "wind_speed",
  value: 4.2,
  unit: "m/s",
  ts,
});

/** Store en memoria con la misma semántica de idempotencia que Postgres. */
export class MemoryStore implements Store {
  readonly keys = new Set<string>();
  readonly health = new Map<string, SourceHealth>();
  writes = 0;

  async write(rows: ValidRows): Promise<number> {
    let n = 0;
    const add = (k: string): void => {
      if (!this.keys.has(k)) {
        this.keys.add(k);
        n++;
      }
    };
    rows.positions.forEach((e) => add(`p:${e.id}:${e.ts}`));
    rows.stations.forEach((s) => add(`s:${s.id}:${s.ts}`));
    rows.observations.forEach((o) => add(`o:${o.stationId}:${o.metric}:${o.ts}`));
    this.writes++;
    return n;
  }
  async getHealth(id: string): Promise<SourceHealth | null> {
    return this.health.get(id) ?? null;
  }
  async saveHealth(h: SourceHealth): Promise<void> {
    this.health.set(h.sourceId, h);
  }
}

export type Step = (signal: AbortSignal) => Promise<unknown>;

export interface FakeAdapterOptions {
  id?: string;
  intervalMs?: number;
  /** Comportamiento por llamada (índice); se repite el último. Lanzar = fallo. */
  script: Step[];
}

export function fakeAdapter(opts: FakeAdapterOptions): IngestAdapter & { calls: number } {
  const adapter = {
    id: opts.id ?? "fake",
    intervalMs: opts.intervalMs ?? 60_000,
    calls: 0,
    fetch(signal: AbortSignal): Promise<unknown> {
      const step = opts.script[Math.min(adapter.calls, opts.script.length - 1)];
      if (!step) throw new Error("script vacío");
      adapter.calls++;
      return step(signal);
    },
    parse: (raw: unknown): Row[] => raw as Row[],
  };
  return adapter;
}

export const ok =
  (rows: unknown[]): Step =>
  async () =>
    rows;
export const fail =
  (msg: string): Step =>
  async () => {
    throw new Error(msg);
  };

export function makeDeps(overrides: Partial<CycleDeps["config"]> = {}) {
  const clock = new FakeClock();
  const store = new MemoryStore();
  const deps: CycleDeps = {
    store,
    clock,
    logger: silentLogger,
    random: () => 1, // sin jitter: espera exacta = tope
    config: {
      timeoutMs: 5_000,
      maxAttempts: 3,
      backoffBaseMs: 1_000,
      backoffMaxMs: 30_000,
      downAfter: 3,
      ...overrides,
    },
  };
  return { clock, store, deps };
}
