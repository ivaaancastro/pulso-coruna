import { LAYER_IDS } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import {
  DISCONNECT_GRACE_MS,
  SOURCE_THRESHOLDS,
  layerStatus,
  stateOpacity,
  worstState,
  type ConnectionSnapshot,
  type SourceState,
} from "./source-status";
import { T0 } from "./test-helpers";

const open: ConnectionSnapshot = { state: "open", downForMs: 0 };
const th = SOURCE_THRESHOLDS.bus; // 60 s / 120 s
const st = (over: Partial<Parameters<typeof layerStatus>[0]> = {}) =>
  layerStatus({
    now: T0,
    freshness: { receivedAt: T0, dataTs: T0 },
    connection: open,
    thresholds: th,
    ...over,
  });

describe("layerStatus", () => {
  it("vivo / retrasado / sin datos según la edad del dato y los umbrales de la capa", () => {
    const at = (ageMs: number) => st({ freshness: { receivedAt: T0, dataTs: T0 - ageMs } }).state;
    expect(at(0)).toBe("live");
    expect(at(th.delayedMs - 1)).toBe("live");
    expect(at(th.delayedMs)).toBe("delayed");
    expect(at(th.nodataMs - 1)).toBe("delayed");
    expect(at(th.nodataMs)).toBe("nodata");
    expect(at(60 * 60_000)).toBe("nodata");
  });

  it("devuelve la última marca conocida para «desde hace X»", () => {
    const r = st({ freshness: { receivedAt: T0, dataTs: T0 - 7 * 60_000 } });
    expect(r).toEqual({ state: "nodata", lastDataAt: T0 - 7 * 60_000 });
  });

  it("dataTs 0 o ausente es «sin dato», no «hace 55 años»", () => {
    expect(st({ freshness: { receivedAt: T0, dataTs: 0 } })).toEqual({
      state: "nodata",
      lastDataAt: null,
    });
    expect(st({ freshness: { receivedAt: T0, dataTs: Number.NaN } }).state).toBe("nodata");
    expect(st({ freshness: { receivedAt: T0, dataTs: -5 } }).lastDataAt).toBeNull();
  });

  it("sin frescura (antes del primer snapshot) no alarma", () => {
    expect(st({ freshness: undefined })).toEqual({ state: "live", lastDataAt: null });
    expect(
      st({ freshness: undefined, connection: { state: "connecting", downForMs: 0 } }).state,
    ).toBe("live");
  });

  it("un reloj adelantado respecto al dato no da edades negativas", () => {
    expect(st({ freshness: { receivedAt: T0, dataTs: T0 + 5 * 60_000 } }).state).toBe("live");
  });

  it("desconectado solo tras la gracia, y distinto de sin datos", () => {
    const down = (ms: number, state: ConnectionSnapshot["state"] = "reconnecting") =>
      st({ connection: { state, downForMs: ms } }).state;
    expect(down(DISCONNECT_GRACE_MS - 1)).toBe("live");
    expect(down(DISCONNECT_GRACE_MS)).toBe("disconnected");
    expect(down(DISCONNECT_GRACE_MS, "closed")).toBe("disconnected");
    // connecting/idle nunca cuentan como desconexión
    expect(down(60_000, "connecting")).toBe("live");
    // con la conexión caída manda la desconexión aunque el dato sea viejo
    expect(
      st({
        freshness: { receivedAt: T0, dataTs: T0 - 99 * 60_000 },
        connection: { state: "reconnecting", downForMs: 60_000 },
      }).state,
    ).toBe("disconnected");
  });

  it("health aporta la edad solo cuando el almacén no tiene marca", () => {
    const empty = { receivedAt: T0, dataTs: 0 };
    expect(st({ freshness: empty, healthLastDataAt: T0 - 7 * 60_000 })).toEqual({
      state: "nodata",
      lastDataAt: T0 - 7 * 60_000,
    });
    expect(st({ freshness: empty, healthLastDataAt: null }).lastDataAt).toBeNull();
    // con marca propia, health no manda (aunque diga que hay algo más reciente)
    const own = { receivedAt: T0, dataTs: T0 - 10 * 60_000 };
    expect(st({ freshness: own, healthLastDataAt: T0 }).state).toBe("nodata");
  });

  it("la tabla cubre todas las capas con umbrales coherentes", () => {
    for (const layer of LAYER_IDS) {
      const t = SOURCE_THRESHOLDS[layer];
      expect(t.delayedMs).toBeGreaterThan(0);
      expect(t.nodataMs).toBeGreaterThan(t.delayedMs);
    }
    expect(SOURCE_THRESHOLDS.bus.nodataMs).toBe(2 * 60_000);
    expect(SOURCE_THRESHOLDS.bike.nodataMs).toBe(5 * 60_000);
    expect(SOURCE_THRESHOLDS.weather.nodataMs).toBe(30 * 60_000);
  });
});

describe("worstState / stateOpacity", () => {
  it("elige el peor estado", () => {
    expect(worstState([])).toBe("live");
    expect(worstState(["live", "delayed"])).toBe("delayed");
    expect(worstState(["delayed", "nodata", "live"])).toBe("nodata");
    expect(worstState(["delayed", "disconnected"])).toBe("disconnected");
  });

  it("nodata aplica el token entero; el resto, una fracción monótona", () => {
    const o = (s: SourceState) => stateOpacity(s, 0.35);
    expect(o("live")).toBe(1);
    expect(o("nodata")).toBe(0.35);
    expect(o("live")).toBeGreaterThan(o("delayed"));
    expect(o("delayed")).toBeGreaterThan(o("disconnected"));
    expect(o("disconnected")).toBeGreaterThan(o("nodata"));
    expect(stateOpacity("nodata", 7)).toBe(1); // token absurdo: se acota
  });
});
