import { describe, expect, it } from "vitest";
import { air, station, T0 } from "../test-helpers";
import {
  AIR_RGB,
  BREATH_PERIOD_MS,
  DAY_BOOST,
  ERROR_RGB,
  LEVEL_RGB,
  LEVEL_STYLE,
  MAX_AGE_MS,
  WARN_RGB,
  breath,
  centreOpacity,
  dayBoost,
  eaqiLevel,
  haloGain,
  haloRings,
  readAir,
} from "./model";
import { AIR_STATIONS, isModelStation } from "./stations";

const full = () => [
  air("eaqi", 29),
  air("pm25", 3.6),
  air("pm10", 10),
  air("no2", 2.6),
  air("o3", 78),
  air("so2", 0.6),
];

describe("eaqiLevel (tramos de Open-Meteo)", () => {
  it("traduce la escala 0–100+ a niveles 1–6", () => {
    expect([0, 20, 21, 29, 40, 41, 60, 61, 80, 81, 100, 101, 400].map(eaqiLevel)).toEqual([
      1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
  });

  it("rechaza valores no válidos", () => {
    expect(eaqiLevel(-1)).toBeNull();
    expect(eaqiLevel(Number.NaN)).toBeNull();
    expect(eaqiLevel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("stations", () => {
  it("el punto real está en la tabla y es de modelo", () => {
    const s = AIR_STATIONS["openmeteo:coruna:model"];
    expect(s).toMatchObject({ lon: -8.4115, lat: 43.3623 });
    expect(isModelStation("openmeteo:coruna:model")).toBe(true);
    expect(isModelStation("ES/SP_15030001")).toBe(false);
  });
});

describe("readAir", () => {
  it("lee EAQI, nivel y contaminantes con unidades", () => {
    const r = readAir(full(), T0);
    expect(r).toMatchObject({
      stationId: "openmeteo:coruna:model",
      lon: -8.4115,
      lat: 43.3623,
      model: true,
      eaqi: 29,
      level: 2,
      ts: T0,
    });
    expect(r?.pollutants.pm25).toEqual({ value: 3.6, unit: "µg/m³" });
    expect(Object.keys(r?.pollutants ?? {}).sort()).toEqual(["no2", "o3", "pm10", "pm25", "so2"]);
  });

  it("sin eaqi no hay lectura (no se deduce de los contaminantes)", () => {
    expect(
      readAir(
        full().filter((o) => o.metric !== "eaqi"),
        T0,
      ),
    ).toBeNull();
  });

  it("ignora eaqi inválido, puntos desconocidos, otras capas y datos muy viejos", () => {
    expect(readAir([air("eaqi", -3)], T0)).toBeNull();
    expect(readAir([air("eaqi", 30, { stationId: "otro:punto" })], T0)).toBeNull();
    expect(readAir([station("1"), air("eaqi", 30, { layer: "weather" })], T0)).toBeNull();
    expect(readAir([air("eaqi", 30)], T0 + MAX_AGE_MS + 1)).toBeNull();
    expect(readAir([air("eaqi", 30)], T0 + MAX_AGE_MS)).not.toBeNull();
  });

  it("un contaminante ausente simplemente no aparece", () => {
    const r = readAir([air("eaqi", 50), air("pm10", 9)], T0);
    expect(r?.level).toBe(3);
    expect(Object.keys(r?.pollutants ?? {})).toEqual(["pm10"]);
  });

  it("con varias horas de la misma métrica gana la más reciente", () => {
    const r = readAir(
      [air("eaqi", 90, { ts: T0 }), air("eaqi", 10, { ts: T0 + 3_600_000 })],
      T0 + 3_600_000,
    );
    expect(r?.eaqi).toBe(10);
    expect(r?.ts).toBe(T0 + 3_600_000);
  });
});

describe("escala de color con tokens", () => {
  it("va de air a warn a error", () => {
    expect(LEVEL_RGB[1]).toEqual(AIR_RGB);
    expect(LEVEL_RGB[2]).toEqual(AIR_RGB);
    expect(LEVEL_RGB[4]).toEqual(WARN_RGB);
    expect(LEVEL_RGB[6]).toEqual(ERROR_RGB);
    expect(LEVEL_RGB[3]).toEqual([211, 158, 141]);
    expect(LEVEL_RGB[5]).toEqual([255, 142, 70]);
  });

  it("intensidad, tamaño y respiración crecen con el nivel", () => {
    for (const l of [1, 2, 3, 4, 5] as const) {
      expect(LEVEL_STYLE[(l + 1) as 2].peak).toBeGreaterThan(LEVEL_STYLE[l].peak);
      expect(LEVEL_STYLE[(l + 1) as 2].radiusM).toBeGreaterThan(LEVEL_STYLE[l].radiusM);
      expect(LEVEL_STYLE[(l + 1) as 2].breath).toBeGreaterThan(LEVEL_STYLE[l].breath);
    }
  });
});

describe("haloRings", () => {
  it("discos concéntricos hasta el radio del nivel, todos en el mismo punto", () => {
    const rings = haloRings(-8.4115, 43.3623, 3, 12);
    expect(rings).toHaveLength(12);
    expect(rings.at(-1)?.radius).toBe(LEVEL_STYLE[3].radiusM);
    expect(rings.every((r) => r.position[0] === -8.4115 && r.position[1] === 43.3623)).toBe(true);
    const radii = rings.map((r) => r.radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
  });

  it("el centro acumula la opacidad pico del nivel (alfa de un byte + ganancia de la capa)", () => {
    for (const level of [1, 2, 4, 6] as const) {
      for (const n of [8, 12, 18]) {
        for (const boost of [1, DAY_BOOST]) {
          const rings = haloRings(0, 0, level, n, boost);
          const gain = haloGain(rings, level, boost);
          expect(gain).toBeLessThanOrEqual(1);
          expect(gain).toBeGreaterThan(0.6);
          expect(centreOpacity(rings) * gain).toBeCloseTo(LEVEL_STYLE[level].peak * boost, 6);
        }
      }
    }
  });

  it("el refuerzo diurno sube el alfa y tiene tope", () => {
    const night = haloRings(0, 0, 2, 12, 1)[0]?.alpha ?? 0;
    const day = haloRings(0, 0, 2, 12, DAY_BOOST)[0]?.alpha ?? 0;
    expect(day).toBeGreaterThan(night);
    expect(haloRings(0, 0, 6, 12, 100)[0]?.alpha).toBeLessThan(255 * 0.3);
  });
});

describe("breath", () => {
  it("sin movimiento es siempre el reposo", () => {
    for (const t of [0, 1500, 3000, 4500]) {
      expect(breath(6, t, false)).toEqual({ radiusScale: 1, opacity: 1 });
    }
  });

  it("periodo de 6 s: reposo en 0, máximo a mitad de periodo, y vuelve", () => {
    const rest = breath(4, 0, true);
    const peak = breath(4, BREATH_PERIOD_MS / 2, true);
    expect(rest).toEqual({ radiusScale: 1, opacity: 1 });
    expect(peak.radiusScale).toBeCloseTo(1 + LEVEL_STYLE[4].breath, 10);
    expect(peak.opacity).toBeCloseTo(1 - 2 * LEVEL_STYLE[4].breath, 10);
    expect(breath(4, BREATH_PERIOD_MS, true).radiusScale).toBeCloseTo(1, 10);
  });

  it("amplitud mayor cuanto peor el nivel y la opacidad nunca cae a cero", () => {
    expect(breath(6, 3000, true).radiusScale).toBeGreaterThan(breath(1, 3000, true).radiusScale);
    expect(breath(6, 3000, true).opacity).toBeGreaterThan(0.7);
  });
});

describe("dayBoost", () => {
  it("1 de noche, DAY_BOOST con el sol alto, monótono", () => {
    expect(dayBoost(-30)).toBe(1);
    expect(dayBoost(40)).toBeCloseTo(DAY_BOOST, 10);
    expect(dayBoost(0)).toBeGreaterThan(dayBoost(-3));
    expect(dayBoost(0)).toBeLessThan(dayBoost(10));
  });
});
