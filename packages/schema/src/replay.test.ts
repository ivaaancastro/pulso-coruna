import { describe, expect, it } from "vitest";
import {
  REPLAY_WINDOW_MS,
  ReplayWindowSchema,
  fromReplayCoord,
  fromReplaySpeed,
  replayKindForLayer,
  toReplayCoord,
  toReplaySpeed,
} from "./index.js";

const FROM = 1_760_000_100_000;
const track = {
  id: "bus:1",
  meta: { line: "1A" },
  init: { dt: -20_000, lon: -840_000, lat: 4_336_000, heading: 90, speed: 50 },
  ts: [0, 15_000, 30_000],
  lon: [-840_010, -840_020, -840_030],
  lat: [4_336_000, 4_336_010, 4_336_020],
  heading: [90, null, 91],
};
const win = (layers: unknown, over: Record<string, unknown> = {}): unknown => ({
  v: 1,
  from: FROM,
  to: FROM + REPLAY_WINDOW_MS,
  resolution: "raw",
  layers,
  ...over,
});
const ok = (x: unknown): boolean => ReplayWindowSchema.safeParse(x).success;
const busWith = (t: object): unknown =>
  win({ bus: { kind: "mobile", tracks: [{ ...track, ...t }] } });

describe("ReplayWindowSchema", () => {
  it("acepta móviles, estaciones y series", () => {
    const m = win({
      bus: { kind: "mobile", tracks: [track] },
      bike: {
        kind: "station",
        stations: [
          {
            id: "s1",
            lon: -841_000,
            lat: 4_337_000,
            init: { dt: -60_000, bikes: 3, docks: 7 },
            ts: [10_000],
            bikes: [2],
            docks: [8],
          },
        ],
      },
      weather: {
        kind: "series",
        series: [
          {
            stationId: "10157",
            metric: "wind_speed",
            unit: "m/s",
            init: { dt: -1000, value: 4 },
            ts: [0, 1000],
            value: [4.5, 5],
          },
        ],
      },
    });
    expect(ok(m)).toBe(true);
  });

  it("acepta una ventana vacía y capas vacías", () => {
    expect(ok(win({}))).toBe(true);
    expect(ok(win({ bus: { kind: "mobile", tracks: [] } }))).toBe(true);
  });

  it("rechaza versión distinta, claves desconocidas y resolución inválida", () => {
    expect(ok(win({}, { v: 2 }))).toBe(false);
    expect(ok(win({}, { extra: 1 }))).toBe(false);
    expect(ok(win({}, { resolution: "5m" }))).toBe(false);
  });

  it("rechaza ventanas vacías, invertidas o de más de 5 min", () => {
    expect(ok(win({}, { to: FROM }))).toBe(false);
    expect(ok(win({}, { to: FROM + REPLAY_WINDOW_MS + 1 }))).toBe(false);
  });

  it("rechaza un payload que no corresponde a la capa", () => {
    expect(ok(win({ bike: { kind: "mobile", tracks: [track] } }))).toBe(false);
    expect(ok(win({ metro: { kind: "mobile", tracks: [] } }))).toBe(false);
  });

  it("rechaza columnas de distinta longitud, ts no crecientes o fuera de ventana", () => {
    expect(ok(busWith({}))).toBe(true);
    expect(ok(busWith({ lat: [1, 2] }))).toBe(false);
    expect(ok(busWith({ heading: [90] }))).toBe(false);
    expect(ok(busWith({ ts: [0, 0, 30_000] }))).toBe(false);
    expect(ok(busWith({ ts: [0, 15_000, REPLAY_WINDOW_MS] }))).toBe(false);
    expect(ok(busWith({ ts: [-1, 15_000, 30_000] }))).toBe(false);
    expect(ok(busWith({ init: { ...track.init, dt: 5 } }))).toBe(false);
  });

  it("rechaza valores no enteros en columnas cuantizadas", () => {
    expect(ok(busWith({ lon: [-8.4, 1, 2] }))).toBe(false);
  });
});

describe("cuantización y tipos por capa", () => {
  it("ida y vuelta con error < 1e-5° y 0,1 m/s", () => {
    expect(fromReplayCoord(toReplayCoord(-8.40123456))).toBeCloseTo(-8.40123, 5);
    expect(fromReplaySpeed(toReplaySpeed(5.26))).toBeCloseTo(5.3, 5);
  });
  it("replayKindForLayer", () => {
    expect(replayKindForLayer("bus")).toBe("mobile");
    expect(replayKindForLayer("plane")).toBe("mobile");
    expect(replayKindForLayer("bike")).toBe("station");
    expect(replayKindForLayer("sea")).toBe("series");
  });
});
