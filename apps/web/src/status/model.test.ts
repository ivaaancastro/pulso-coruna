import { describe, expect, it } from "vitest";
import { deriveRows, parseHealthReport } from "./model";
import { SOURCES } from "./sources";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const body = (sources: unknown[], extra: Record<string, unknown> = {}) => ({
  v: 1,
  ts: NOW,
  status: "ok",
  db: { ok: true, latencyMs: 2 },
  sources,
  layers: {},
  ...extra,
});

describe("parseHealthReport", () => {
  it("lee fuentes con estado y última lectura", () => {
    const r = parseHealthReport(
      body([
        { id: "bicicoruna", status: "ok", lastSuccessAt: NOW - 1000 },
        { id: "portus", status: "degraded", lastSuccessAt: null },
      ]),
    );
    expect(r?.ts).toBe(NOW);
    expect(r?.db).toBe(true);
    expect(r?.sources.get("bicicoruna")).toEqual({ status: "ok", lastSuccessAt: NOW - 1000 });
    expect(r?.sources.get("portus")).toEqual({ status: "degraded", lastSuccessAt: null });
  });

  it("ignora entradas mal formadas y reconoce la BD caída (cuerpo del 503)", () => {
    const r = parseHealthReport(
      body([null, 5, { id: 3 }, { id: "x", status: "raro" }, { id: "ok", status: "ok" }], {
        db: { ok: false, latencyMs: null },
        status: "down",
      }),
    );
    expect([...(r?.sources.keys() ?? [])]).toEqual(["ok"]);
    expect(r?.db).toBe(false);
  });

  it("devuelve null si no es un informe", () => {
    const bad = [null, "x", 3, {}, { ts: NOW }, { ts: "no", sources: [] }, { ts: -1, sources: [] }];
    for (const b of bad) expect(parseHealthReport(b)).toBeNull();
  });
});

describe("deriveRows", () => {
  const rows = (sources: unknown[]) => {
    const report = parseHealthReport(body(sources));
    if (!report) throw new Error("informe");
    const derived = deriveRows(SOURCES, report);
    return new Map(SOURCES.map((s, i) => [s.key, derived[i]]));
  };

  it("traduce el estado de la API al vocabulario de las capas", () => {
    const r = rows([
      { id: "bicicoruna", status: "ok", lastSuccessAt: NOW - 5000 },
      { id: "portus", status: "degraded", lastSuccessAt: NOW - 3_000_000 },
      { id: "opensky", status: "down", lastSuccessAt: null },
    ]);
    expect(r.get("bicicoruna")).toMatchObject({ state: "live", lastSuccessAt: NOW - 5000 });
    expect(r.get("portus")?.state).toBe("delayed");
    expect(r.get("opensky")).toMatchObject({ state: "nodata", lastSuccessAt: null });
  });

  it("una fuente que no figura en el informe está «no activa»; las estáticas no tienen estado", () => {
    const r = rows([]);
    expect(r.get("itranvias")?.state).toBe("inactive");
    expect(r.get("osm")?.state).toBe("static");
    expect(r.get("catastro")?.state).toBe("static");
  });

  it("una fuente con varios ids toma el peor estado y la lectura más reciente", () => {
    const r = rows([
      { id: "bus-schedule", status: "ok", lastSuccessAt: NOW - 1000 },
      { id: "gtfs-tranvias", status: "down", lastSuccessAt: NOW - 9000 },
    ]);
    expect(r.get("tranvias-gtfs")).toMatchObject({ state: "nodata", lastSuccessAt: NOW - 1000 });
  });
});
