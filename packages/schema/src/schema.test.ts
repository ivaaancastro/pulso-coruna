import { describe, expect, it } from "vitest";
import {
  DeltaMessageSchema,
  EntitySchema,
  LayerIdSchema,
  ObservationSchema,
  SnapshotMessageSchema,
  StationStatusSchema,
  WsMessageSchema,
} from "./index.js";

const TS = 1_760_000_000_000;
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
  ])("rechaza %s", (_n, patch) => {
    expect(StationStatusSchema.safeParse({ ...station, ...patch }).success).toBe(false);
  });
});

describe("ObservationSchema", () => {
  it("acepta válido (también valores negativos)", () => {
    expect(ObservationSchema.safeParse(obs).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...obs, layer: "sea", value: -0.4 }).success).toBe(true);
  });
  it.each([
    ["layer incorrecto", { layer: "bus" }],
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
  it("rechaza elementos inválidos y removes vacíos", () => {
    expect(
      WsMessageSchema.safeParse({ ...delta, upserts: [{ ...entity, lat: 100 }] }).success,
    ).toBe(false);
    expect(WsMessageSchema.safeParse({ ...delta, removes: [""] }).success).toBe(false);
  });
});
