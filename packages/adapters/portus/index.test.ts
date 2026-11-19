import { describe, expect, it } from "vitest";
import { observationKey } from "@pulso/schema";
import fixtureJson from "./fixtures/lastdata-3219-2026-11-19T14-56Z.json";
import { buildUrl, createPortusAdapter, parse, parseUtcInstant, portusEnabled } from "./index.js";

const fixture: unknown = fixtureJson;
const TS = Date.UTC(2026, 10, 19, 14, 56, 0);

const level = (over: Record<string, unknown> = {}) => ({
  fecha: "2026-11-19 14:56:00.0",
  datos: [
    {
      variable: "SEA_LEVEL",
      valor: "2535",
      factor: 1000.0,
      unidad: "m",
      averia: false,
      ...over,
    },
  ],
});

describe("portus parse (fixture real)", () => {
  it("convierte milésimas a metros con ts en epoch ms UTC", () => {
    expect(parse(fixture)).toEqual([
      {
        stationId: "portus:3219",
        layer: "sea",
        metric: "tide_level",
        value: 2.535,
        unit: "m",
        ts: TS,
      },
    ]);
  });

  it("la hora de la fuente se toma como UTC (no la local de Madrid)", () => {
    expect(new Date(parse(fixture)[0]?.ts ?? 0).toISOString()).toBe("2026-11-19T14:56:00.000Z");
  });

  it("clave estación:métrica estable", () => {
    expect(parse(fixture).map(observationKey)).toEqual(["portus:3219:tide_level"]);
  });
});

describe("portus parse (casos límite)", () => {
  it("vacío o forma inesperada: []", () => {
    for (const raw of [null, undefined, [], "x", {}, { fecha: "2026-11-19 14:56:00.0" }]) {
      expect(parse(raw)).toEqual([]);
    }
    expect(parse({ fecha: "2026-11-19 14:56:00.0", datos: [] })).toEqual([]);
  });

  it("ignora variables distintas de SEA_LEVEL", () => {
    expect(parse(level({ variable: "SEICHE" }))).toEqual([]);
  });

  it("descarta avería", () => {
    expect(parse(level({ averia: true }))).toEqual([]);
  });

  it.each([
    ["centinela -9999", { valor: "-9999" }],
    ["valor vacío", { valor: "" }],
    ["valor no numérico", { valor: "n/d" }],
    ["valor null", { valor: null }],
    ["factor ausente", { factor: undefined }],
    ["factor cero", { factor: 0 }],
    ["fuera de rango", { valor: "99000" }],
    ["unidad distinta", { unidad: "cm" }],
  ])("descarta %s", (_n, patch) => {
    expect(parse(level(patch))).toEqual([]);
  });

  it("acepta valores negativos plausibles (bajamar bajo el cero)", () => {
    expect(parse(level({ valor: "-120" }))[0]?.value).toBe(-0.12);
  });

  it("fecha ilegible o imposible: []", () => {
    expect(parse({ ...level(), fecha: "ayer" })).toEqual([]);
    expect(parse({ ...level(), fecha: "2026-02-31 10:00:00.0" })).toEqual([]);
    expect(parse({ ...level(), fecha: undefined })).toEqual([]);
  });

  it("parseUtcInstant acepta con y sin décimas", () => {
    expect(parseUtcInstant("2026-11-19 14:56:00.0")).toBe(TS);
    expect(parseUtcInstant("2026-11-19 14:56:00")).toBe(TS);
  });
});

describe("portus adapter", () => {
  it("construye la URL y expone id e intervalo", () => {
    expect(buildUrl("3219")).toBe(
      "https://portus.puertos.es/portussvr/api/lastData/station/3219?locale=es",
    );
    const a = createPortusAdapter();
    expect(a.id).toBe("portus");
    expect(a.intervalMs).toBe(300_000);
    expect(a.parse(fixture)).toHaveLength(1);
  });

  it("estación configurable en stationId", () => {
    expect(createPortusAdapter({ station: "9999" }).parse(fixture)[0]?.stationId).toBe(
      "portus:9999",
    );
  });

  it("fetch hace POST con cuerpo SEA_LEVEL y lanza si no es 2xx", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const orig = globalThis.fetch;
    let status = 200;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(fixture), { status }));
    }) as typeof fetch;
    try {
      const a = createPortusAdapter();
      expect(await a.fetch(new AbortController().signal)).toEqual(fixture);
      expect(calls[0]?.init.method).toBe("POST");
      expect(calls[0]?.init.body).toBe('["SEA_LEVEL"]');
      status = 500;
      await expect(a.fetch(new AbortController().signal)).rejects.toThrow("HTTP 500");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("solo se habilita con PORTUS_ENABLED=true", () => {
    expect(portusEnabled({})).toBe(false);
    expect(portusEnabled({ PORTUS_ENABLED: "1" })).toBe(false);
    expect(portusEnabled({ PORTUS_ENABLED: "true" })).toBe(true);
  });
});
