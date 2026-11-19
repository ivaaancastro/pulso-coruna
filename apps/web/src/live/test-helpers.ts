import type {
  DeltaMessage,
  Entity,
  Observation,
  SnapshotMessage,
  StationStatus,
} from "@pulso/schema";
import type { SocketLike } from "./ws-client";

/** Utilidades solo para tests (no se importan desde código de producción). */
export const T0 = 1_760_000_000_000;

export const bus = (id: string, over: Partial<Entity> = {}): Entity => ({
  id,
  layer: "bus",
  lon: -8.4,
  lat: 43.37,
  ts: T0,
  ...over,
});

export const station = (id: string, over: Partial<StationStatus> = {}): StationStatus => ({
  id,
  layer: "bike",
  lon: -8.4,
  lat: 43.37,
  bikes: 5,
  docks: 10,
  ts: T0,
  ...over,
});

export const wind = (stationId: string, over: Partial<Observation> = {}): Observation => ({
  stationId,
  layer: "weather",
  metric: "wind_speed",
  value: 3,
  unit: "m/s",
  ts: T0,
  ...over,
});

export const air = (
  metric: string,
  value: number,
  over: Partial<Observation> = {},
): Observation => ({
  stationId: "openmeteo:coruna:model",
  layer: "air",
  metric,
  value,
  unit: metric === "eaqi" ? "EAQI" : "µg/m³",
  ts: T0,
  ...over,
});

export const snapshot = (layers: SnapshotMessage["layers"], ts = T0): SnapshotMessage => ({
  v: 1,
  type: "snapshot",
  ts,
  layers,
});

export const delta = (
  layer: DeltaMessage["layer"],
  upserts: DeltaMessage["upserts"],
  removes: string[] = [],
  ts = T0,
): DeltaMessage => ({ v: 1, type: "delta", ts, layer, upserts, removes });

export class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.({});
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  drop(): void {
    this.onclose?.({});
  }
}

/** Temporizador manual: `run()` ejecuta el pendiente más antiguo y devuelve el retardo pedido. */
export function manualTimers() {
  const pending: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      pending.push({ fn, ms, id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = pending.findIndex((p) => p.id === h);
      if (i >= 0) pending.splice(i, 1);
    },
    get pending() {
      return pending.length;
    },
    run(): number {
      const p = pending.shift();
      if (!p) throw new Error("sin temporizador pendiente");
      p.fn();
      return p.ms;
    },
  };
}
