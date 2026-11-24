import { DeltaMessageSchema, SnapshotMessageSchema, observationKey } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { diffLayer, itemKey, type LayerState } from "../src/diff.js";
import { buildHealth, effectiveStatus } from "../src/health.js";
import { ConnectionLimiter } from "../src/limiter.js";
import { deltaMessage, parseLayers, snapshotMessage } from "../src/protocol.js";
import { bus, emptyLayers, station, T0, wind } from "./helpers.js";

describe("diffLayer", () => {
  const stateOf = (layer: "bus" | "weather", items: Parameters<typeof diffLayer>[2]): LayerState =>
    diffLayer(layer, new Map(), items).next;

  it("estado vacío: todo son upserts", () => {
    const d = diffLayer("bus", new Map(), [bus("a"), bus("b")]);
    expect(d.upserts).toHaveLength(2);
    expect(d.removes).toEqual([]);
  });

  it("sin cambios no hay delta", () => {
    const prev = stateOf("bus", [bus("a"), bus("b")]);
    const d = diffLayer("bus", prev, [bus("a"), bus("b")]);
    expect(d.upserts).toEqual([]);
    expect(d.removes).toEqual([]);
  });

  it("detecta cambios, altas y bajas por id", () => {
    const prev = stateOf("bus", [bus("a"), bus("b"), bus("c")]);
    const d = diffLayer("bus", prev, [bus("a", -8.5), bus("b"), bus("d")]);
    expect(d.upserts.map((u) => (u as { id: string }).id).sort()).toEqual(["a", "d"]);
    expect(d.removes).toEqual(["c"]);
    expect([...d.next.keys()].sort()).toEqual(["a", "b", "d"]);
  });

  it("observaciones: clave stationId:metric; la baja usa esa clave", () => {
    const o = wind("est1");
    expect(itemKey("weather", o)).toBe(observationKey(o));
    const prev = stateOf("weather", [o, wind("est1", 2, { metric: "wind_dir", unit: "deg" })]);
    const d = diffLayer("weather", prev, [wind("est1", 7)]);
    expect(d.upserts).toHaveLength(1);
    expect(d.removes).toEqual(["est1:wind_dir"]);
  });

  it("un cambio solo de ts también es upsert", () => {
    const prev = stateOf("bus", [bus("a")]);
    expect(diffLayer("bus", prev, [bus("a", -8.4, { ts: T0 + 1000 })]).upserts).toHaveLength(1);
  });
});

describe("mensajes: cumplen el contrato de @pulso/schema", () => {
  it("snapshot con capas vacías y con datos", () => {
    const items = emptyLayers();
    items.bike = [station("s1")];
    items.weather = [wind("e1")];
    const m = snapshotMessage(T0, ["bike", "weather", "bus"], items);
    expect(SnapshotMessageSchema.safeParse(m).success).toBe(true);
    expect(m.layers.bus).toEqual([]);
    expect(Object.keys(m.layers)).toEqual(["bike", "weather", "bus"]);
  });

  it("delta válido; un elemento de otra capa se rechaza", () => {
    expect(DeltaMessageSchema.safeParse(deltaMessage(T0, "bus", [bus("a")], ["x"])).success).toBe(
      true,
    );
    expect(DeltaMessageSchema.safeParse(deltaMessage(T0, "bike", [bus("a")], [])).success).toBe(
      false,
    );
  });
});

describe("parseLayers", () => {
  it("sin parámetro = todas", () => {
    const r = parseLayers(undefined);
    expect(r.ok && r.layers).toHaveLength(8);
  });
  it("lista, con espacios y duplicados", () => {
    expect(parseLayers("bus, bike,bus")).toEqual({ ok: true, layers: ["bus", "bike"] });
  });
  it("desconocidas, vacío y tipo raro → error", () => {
    expect(parseLayers("bus,nope")).toMatchObject({ ok: false });
    expect(parseLayers("")).toMatchObject({ ok: false });
    expect(parseLayers("bus,")).toMatchObject({ ok: false });
    expect(parseLayers(["bus", "bike"])).toMatchObject({ ok: false });
  });
});

describe("ConnectionLimiter", () => {
  it("límite por IP independiente y liberable", () => {
    const l = new ConnectionLimiter(2);
    expect(l.acquire("1.1.1.1")).toBe(true);
    expect(l.acquire("1.1.1.1")).toBe(true);
    expect(l.acquire("1.1.1.1")).toBe(false);
    expect(l.isFull("1.1.1.1")).toBe(true);
    expect(l.acquire("2.2.2.2")).toBe(true);
    l.release("1.1.1.1");
    expect(l.acquire("1.1.1.1")).toBe(true);
    l.release("2.2.2.2");
    expect(l.count("2.2.2.2")).toBe(0);
  });
});

describe("health", () => {
  const row = (over = {}) => ({
    sourceId: "bicicoruna",
    status: "ok" as const,
    intervalMs: 60_000,
    lastSuccessAt: T0,
    lastErrorAt: null,
    consecutiveFailures: 0,
    updatedAt: T0,
    ...over,
  });

  it("estado efectivo según la edad de la última lectura", () => {
    expect(effectiveStatus(row(), T0 + 60_000, 3)).toBe("ok");
    expect(effectiveStatus(row(), T0 + 4 * 60_000, 3)).toBe("degraded");
    expect(effectiveStatus(row(), T0 + 10 * 60_000, 3)).toBe("down");
    // lo que anota la ingesta nunca se mejora
    expect(effectiveStatus(row({ status: "down" }), T0 + 1000, 3)).toBe("down");
    expect(effectiveStatus(row({ lastSuccessAt: null, status: "degraded" }), T0, 3)).toBe(
      "degraded",
    );
  });

  it("informe: BD caída = down; capas sin datos con null", () => {
    const base = { now: T0 + 5000, staleFactor: 3, sources: [row()], freshness: { bike: T0 } };
    const up = buildHealth({ ...base, db: { ok: true, latencyMs: 2 } });
    expect(up.status).toBe("ok");
    expect(up.layers.bike).toEqual({ lastDataAt: T0, ageMs: 5000 });
    expect(up.layers.bus).toEqual({ lastDataAt: null, ageMs: null });
    expect(up.sources[0]).toMatchObject({ id: "bicicoruna", ageMs: 5000 });
    const down = buildHealth({ ...base, db: { ok: false, latencyMs: null }, sources: [] });
    expect(down.status).toBe("down");
    const mixed = buildHealth({
      ...base,
      db: { ok: true, latencyMs: 1 },
      sources: [row(), row({ sourceId: "x", status: "degraded" })],
    });
    expect(mixed.status).toBe("degraded");
  });

  it("sin fuentes y BD bien = ok", () => {
    expect(
      buildHealth({
        now: T0,
        staleFactor: 3,
        db: { ok: true, latencyMs: 1 },
        sources: [],
        freshness: {},
      }).status,
    ).toBe("ok");
  });
});

describe("config", () => {
  const base = { DATABASE_URL: "postgres://x" };
  it("valores por defecto razonables", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      port: 3000,
      wsMaxPerIp: 10,
      pollMs: 2000,
      trustProxy: false,
      corsOrigins: ["*"],
    });
  });
  it("lee el entorno y valida", () => {
    const c = loadConfig({
      ...base,
      API_WS_MAX_PER_IP: "3",
      API_CORS_ORIGINS: "https://a.es, https://b.es",
      API_TRUST_PROXY: "true",
    });
    expect(c).toMatchObject({
      wsMaxPerIp: 3,
      corsOrigins: ["https://a.es", "https://b.es"],
      trustProxy: true,
    });
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, API_WS_MAX_PER_IP: "0" })).toThrow();
    expect(() => loadConfig({ ...base, API_TRUST_PROXY: "si" })).toThrow();
  });

  it("API_FEATURES: vacía por defecto, admite lista y rechaza desconocidas", () => {
    expect(loadConfig(base).features).toEqual([]);
    expect(loadConfig({ ...base, API_FEATURES: " replay, share ,replay" }).features).toEqual([
      "replay",
      "share",
    ]);
    expect(() => loadConfig({ ...base, API_FEATURES: "replay,foo" })).toThrow(/API_FEATURES/);
  });
});
