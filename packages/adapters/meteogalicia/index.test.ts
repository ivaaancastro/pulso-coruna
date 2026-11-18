import { describe, expect, it } from "vitest";
import { observationKey } from "@pulso/schema";
import fixtureJson from "./fixtures/ultimos10min-2026-11-18T17-00Z.json";
import { buildUrl, createMeteoGaliciaAdapter, parse } from "./index.js";

const fixture: unknown = fixtureJson;

const TS = Date.UTC(2026, 10, 18, 17, 0, 0);

const station = (measures: unknown[]) => ({
  listUltimos10min: [
    { idEstacion: 14000, instanteLecturaUTC: "2026-11-18T17:00:00", listaMedidas: measures },
  ],
});
const m = (codigoParametro: string, valor: unknown, lnCodigoValidacion = 1) => ({
  codigoParametro,
  valor,
  lnCodigoValidacion,
});

describe("meteogalicia parse (fixture real)", () => {
  const obs = parse(fixture);
  const get = (id: string, metric: string) =>
    obs.find((o) => o.stationId === id && o.metric === metric);

  it("extrae el viento de 14000 y 14003 en m/s y grados, con ts UTC", () => {
    expect(get("14000", "wind_speed")).toEqual({
      stationId: "14000",
      layer: "weather",
      metric: "wind_speed",
      value: 8.64,
      unit: "m/s",
      ts: TS,
    });
    expect(get("14000", "wind_dir")?.value).toBe(209);
    expect(get("14000", "wind_dir")?.unit).toBe("deg");
    expect(get("14000", "wind_gust")?.value).toBe(11.6);
    expect(get("14003", "wind_speed")?.value).toBe(10.42);
    expect(get("14003", "wind_dir")?.value).toBe(211);
    expect(get("14003", "wind_gust")?.value).toBe(13.33);
  });

  it("10157 aporta temperatura, humedad y lluvia pero no viento", () => {
    expect(get("10157", "temperature")?.value).toBe(15.1);
    expect(get("10157", "humidity")?.value).toBe(85);
    expect(get("10157", "rain_10m")?.value).toBe(0);
    expect(obs.filter((o) => o.stationId === "10157" && o.metric.startsWith("wind"))).toEqual([]);
  });

  it("descarta la lluvia de 14003 marcada como errónea (código 3)", () => {
    expect(get("14003", "rain_10m")).toBeUndefined();
  });

  it("no repite claves estación:métrica", () => {
    const keys = obs.map(observationKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("meteogalicia parse (casos límite)", () => {
  it("respuesta vacía o con forma inesperada", () => {
    expect(parse({ listUltimos10min: [] })).toEqual([]);
    expect(parse({})).toEqual([]);
    expect(parse(null)).toEqual([]);
    expect(parse("<html>404</html>")).toEqual([]);
    expect(parse(station([]))).toEqual([]);
  });

  it("parámetro ausente: solo emite los presentes", () => {
    const obs = parse(station([m("VV_AVG_10m", 5)]));
    expect(obs.map((o) => o.metric)).toEqual(["wind_speed"]);
  });

  it("descarta valores centinela, nulos y no numéricos", () => {
    const obs = parse(
      station([
        m("VV_AVG_10m", -9999),
        m("DV_AVG_10m", null),
        m("VV_RACHA_10m", "12"),
        m("TA_AVG_1.5m", 14),
      ]),
    );
    expect(obs.map((o) => o.metric)).toEqual(["temperature"]);
  });

  it("descarta valores fuera de rango físico y validaciones 2, 3 y 9", () => {
    const obs = parse(
      station([
        m("DV_AVG_10m", 400),
        m("VV_AVG_10m", 5, 2),
        m("VV_RACHA_10m", 7, 9),
        m("HR_AVG_1.5m", 50, 5),
      ]),
    );
    expect(obs.map((o) => o.metric)).toEqual(["humidity"]);
  });

  it("ignora estaciones con instante ilegible sin romper las demás", () => {
    const raw = {
      listUltimos10min: [
        { idEstacion: 1, instanteLecturaUTC: "basura", listaMedidas: [m("VV_AVG_10m", 3)] },
        ...station([m("VV_AVG_10m", 4)]).listUltimos10min,
      ],
    };
    expect(parse(raw).map((o) => [o.stationId, o.value])).toEqual([["14000", 4]]);
  });

  it("interpreta el instante sin sufijo como UTC", () => {
    expect(parse(station([m("VV_AVG_10m", 1)]))[0]?.ts).toBe(TS);
  });
});

describe("adaptador", () => {
  it("una sola URL con las estaciones configurables", () => {
    expect(buildUrl(["14000", "14003"])).toMatch(/\?idEst=14000,14003$/);
  });

  it("expone id, intervalo entre 5 y 10 min y parse", () => {
    const a = createMeteoGaliciaAdapter({ stations: ["14000"] });
    expect(a.id).toBe("meteogalicia");
    expect(a.intervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(a.intervalMs).toBeLessThanOrEqual(10 * 60_000);
    expect(a.parse(fixture).length).toBeGreaterThan(0);
  });
});
