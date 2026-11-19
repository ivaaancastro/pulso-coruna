import { describe, expect, it } from "vitest";
import { observationKey } from "@pulso/schema";
import fixtureJson from "./fixtures/current-2026-11-19T14-00Z.json";
import {
  buildUrl,
  createOpenMeteoAirAdapter,
  openMeteoAirEnabled,
  parse,
  STATION_ID,
} from "./index.js";

const fixture: unknown = fixtureJson;
const TS = Date.UTC(2026, 10, 19, 14, 0, 0);

const response = (current: Record<string, unknown>, utcOffset: unknown = 0) => ({
  utc_offset_seconds: utcOffset,
  timezone: "GMT",
  current,
});

describe("openmeteo-air parse (fixture real)", () => {
  const obs = parse(fixture);
  const get = (metric: string) => obs.find((o) => o.metric === metric);

  it("extrae las seis métricas con unidades y ts UTC de la hora actual", () => {
    expect(obs).toHaveLength(6);
    expect(get("pm10")).toEqual({
      stationId: "openmeteo:coruna:model",
      layer: "air",
      metric: "pm10",
      value: 10,
      unit: "µg/m³",
      ts: TS,
    });
    expect(get("pm25")?.value).toBe(3.6);
    expect(get("no2")?.value).toBe(2.6);
    expect(get("o3")?.value).toBe(78);
    expect(get("so2")?.value).toBe(0.6);
    expect(get("eaqi")).toMatchObject({ value: 29, unit: "EAQI" });
  });

  it("marca el origen modelo en el stationId y una clave única por métrica", () => {
    expect(STATION_ID.endsWith(":model")).toBe(true);
    expect(new Set(obs.map(observationKey)).size).toBe(6);
  });
});

describe("openmeteo-air parse (casos límite)", () => {
  it("ignora nulos y valores no numéricos o negativos", () => {
    const obs = parse(
      response({
        time: "2026-11-19T14:00",
        pm10: null,
        pm2_5: "3",
        nitrogen_dioxide: -1,
        ozone: 70,
        sulphur_dioxide: Number.NaN,
      }),
    );
    expect(obs.map((o) => o.metric)).toEqual(["o3"]);
  });

  it("devuelve [] con respuesta vacía o malformada", () => {
    expect(parse(null)).toEqual([]);
    expect(parse({})).toEqual([]);
    expect(parse([])).toEqual([]);
    expect(parse(response({}))).toEqual([]);
    expect(parse(response({ pm10: 5 }))).toEqual([]); // sin time
    expect(parse(response({ time: "no-fecha", pm10: 5 }))).toEqual([]);
  });

  it("descarta la respuesta si no está en UTC (no asume zona)", () => {
    expect(parse(response({ time: "2026-11-19T15:00", pm10: 5 }, 3600))).toEqual([]);
    expect(parse({ current: { time: "2026-11-19T15:00", pm10: 5 } })).toEqual([]);
  });
});

describe("openmeteo-air adapter", () => {
  it("construye una única URL de solo `current` con timezone=GMT", () => {
    const url = buildUrl();
    expect(url).toContain("timezone=GMT");
    expect(url).toContain("current=pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide,european_aqi");
    expect(url).not.toContain("hourly");
  });

  it("expone id e intervalo sin tocar la red", () => {
    const a = createOpenMeteoAirAdapter();
    expect(a.id).toBe("openmeteo-air");
    expect(a.intervalMs).toBeGreaterThanOrEqual(60_000);
    expect(a.parse(fixture)).toHaveLength(6);
  });

  it("se activa salvo OPENMETEO_AIR_ENABLED=false", () => {
    expect(openMeteoAirEnabled({})).toBe(true);
    expect(openMeteoAirEnabled({ OPENMETEO_AIR_ENABLED: "false" })).toBe(false);
  });
});
