import { describe, expect, it } from "vitest";
import {
  DeltaMessageSchema,
  EntitySchema,
  LayerIdSchema,
  ObservationSchema,
  observationKey,
  SnapshotMessageSchema,
  StationStatusSchema,
  WsMessageSchema,
} from "./index.js";

const TS = 1_760_000_000_000;
const TS_SECONDS = 1_760_000_000;
const entity = { id: "bus-1", layer: "bus", lon: -8.4, lat: 43.37, ts: TS };
const station = { id: "s1", layer: "bike", lon: -8.4, lat: 43.37, bikes: 3, docks: 7, ts: TS };
const obs = {
  stationId: "10157",
  layer: "weather",
  metric: "wind_speed",
  value: 5.2,
  unit: "m/s",
  ts: TS,
};

describe("LayerId", () => {
  it("acepta capas conocidas y rechaza otras", () => {
    expect(LayerIdSchema.safeParse("plane").success).toBe(true);
    expect(LayerIdSchema.safeParse("metro").success).toBe(false);
  });
});

describe("EntitySchema", () => {
  it("acepta límites geográficos", () => {
    for (const [lat, lon] of [
      [90, 180],
      [-90, -180],
    ] as const) {
      expect(EntitySchema.safeParse({ ...entity, lat, lon }).success).toBe(true);
      expect(StationStatusSchema.safeParse({ ...station, lat, lon }).success).toBe(true);
    }
  });
  it("acepta válido mínimo y completo", () => {
    expect(EntitySchema.safeParse(entity).success).toBe(true);
    expect(
      EntitySchema.safeParse({ ...entity, heading: 360, speed: 0, meta: { line: "1", n: 2 } })
        .success,
    ).toBe(true);
  });
  it.each([
    ["id vacío", { id: "" }],
    ["layer incorrecto", { layer: "metro" }],
    ["lat fuera de rango", { lat: 91 }],
    ["lon fuera de rango", { lon: -181 }],
    ["heading negativo", { heading: -1 }],
    ["heading > 360", { heading: 361 }],
    ["speed negativa", { speed: -0.1 }],
    ["ts no entero", { ts: TS + 0.5 }],
    ["ts cero", { ts: 0 }],
    ["ts en segundos", { ts: TS_SECONDS }],
    ["layer weather (no móvil)", { layer: "weather" }],
    ["layer bike (es estación)", { layer: "bike" }],
    ["ts negativo", { ts: -5 }],
    ["lat NaN", { lat: NaN }],
    ["lon Infinity", { lon: Infinity }],
    ["meta con booleano", { meta: { a: true } }],
    ["clave desconocida", { extra: 1 }],
  ])("rechaza %s", (_n, patch) => {
    expect(EntitySchema.safeParse({ ...entity, ...patch }).success).toBe(false);
  });
});

describe("StationStatusSchema", () => {
  it("acepta válido", () => {
    expect(StationStatusSchema.safeParse(station).success).toBe(true);
  });
  it.each([
    ["layer distinto de bike", { layer: "bus" }],
    ["bikes negativo", { bikes: -1 }],
    ["docks decimal", { docks: 1.5 }],
    ["bikes NaN", { bikes: NaN }],
    ["ts no entero", { ts: 1.5 }],
    ["ts en segundos", { ts: TS_SECONDS }],
  ])("rechaza %s", (_n, patch) => {
    expect(StationStatusSchema.safeParse({ ...station, ...patch }).success).toBe(false);
  });
});

describe("ObservationSchema", () => {
  it("acepta unit vacío", () => {
    expect(ObservationSchema.safeParse({ ...obs, unit: "" }).success).toBe(true);
  });
  it("acepta válido (también valores negativos)", () => {
    expect(ObservationSchema.safeParse(obs).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...obs, layer: "sea", value: -0.4 }).success).toBe(true);
  });
  it.each([
    ["layer incorrecto", { layer: "bus" }],
    ["ts en segundos", { ts: TS_SECONDS }],
    ["value NaN", { value: NaN }],
    ["value Infinity", { value: Infinity }],
    ["value -Infinity", { value: -Infinity }],
    ["unit no string", { unit: 3 }],
    ["metric ausente", { metric: undefined }],
    ["ts no entero", { ts: 1.5 }],
  ])("rechaza %s", (_n, patch) => {
    expect(ObservationSchema.safeParse({ ...obs, ...patch }).success).toBe(false);
  });
});

describe("mensajes WS v1", () => {
  const snapshot = {
    v: 1,
    type: "snapshot",
    ts: TS,
    layers: { bus: [entity], bike: [station], weather: [obs] },
  };
  const delta = {
    v: 1,
    type: "delta",
    ts: TS,
    layer: "bus",
    upserts: [entity],
    removes: ["bus-2"],
  };

  it("snapshot válido, y conserva campos de estación", () => {
    const r = SnapshotMessageSchema.parse(snapshot);
    expect(r.layers.bike?.[0]).toEqual(station);
    expect(WsMessageSchema.parse(snapshot).type).toBe("snapshot");
  });
  it("delta válido, también vacío", () => {
    expect(WsMessageSchema.parse(delta).type).toBe("delta");
    expect(DeltaMessageSchema.safeParse({ ...delta, upserts: [], removes: [] }).success).toBe(true);
  });
  it("rechaza v distinta", () => {
    expect(WsMessageSchema.safeParse({ ...snapshot, v: 2 }).success).toBe(false);
    expect(WsMessageSchema.safeParse({ ...delta, v: 2 }).success).toBe(false);
    expect(WsMessageSchema.safeParse({ ...delta, v: undefined }).success).toBe(false);
  });
  it("rechaza type desconocido y capa inválida", () => {
    expect(WsMessageSchema.safeParse({ ...delta, type: "ping" }).success).toBe(false);
    expect(WsMessageSchema.safeParse({ ...delta, layer: "metro" }).success).toBe(false);
    expect(WsMessageSchema.safeParse({ ...snapshot, layers: { metro: [] } }).success).toBe(false);
  });
  it("rechaza elementos de capa cruzada", () => {
    const bad = (m: unknown) => expect(WsMessageSchema.safeParse(m).success).toBe(false);
    bad({ ...delta, upserts: [obs] });
    bad({ ...delta, upserts: [station] });
    bad({ ...delta, layer: "bike", upserts: [entity] });
    bad({ ...snapshot, layers: { bus: [obs] } });
    bad({ ...snapshot, layers: { weather: [entity] } });
    expect(WsMessageSchema.safeParse({ ...delta, layer: "sea", upserts: [obs] }).success).toBe(
      true,
    );
  });
  it("ida y vuelta JSON de un delta con meta numérica", () => {
    const d = { ...delta, upserts: [{ ...entity, meta: { line: "L1", occupancy: 0.5 } }] };
    const back = WsMessageSchema.parse(JSON.parse(JSON.stringify(WsMessageSchema.parse(d))));
    expect(back).toEqual(d);
  });
  it("la clave de observación es stationId:metric", () => {
    expect(observationKey(obs)).toBe("10157:wind_speed");
  });
  it("rechaza elementos inválidos y removes vacíos", () => {
    expect(
      WsMessageSchema.safeParse({ ...delta, upserts: [{ ...entity, lat: 100 }] }).success,
    ).toBe(false);
    expect(WsMessageSchema.safeParse({ ...delta, removes: [""] }).success).toBe(false);
  });
});
