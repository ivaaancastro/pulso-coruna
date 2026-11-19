import { describe, expect, it } from "vitest";
import { T0, wind } from "../test-helpers";
import {
  buildSamples,
  COVERAGE,
  createWindField,
  FULL_CONFIDENCE_M,
  inCoverage,
  MAX_SAMPLE_AGE_MS,
  NO_CONFIDENCE_M,
  toMetresPerSecond,
  vectorHeading,
  windToVector,
  type WindSample,
} from "./field";

const near = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("conversión de dirección meteorológica (de dónde sopla)", () => {
  // [dirección desde la que sopla, hacia dónde va el aire (rumbo), u, v para 10 m/s]
  const cases: [string, number, number, number, number][] = [
    ["N", 0, 180, 0, -10],
    ["NE", 45, 225, -7.0711, -7.0711],
    ["E", 90, 270, -10, 0],
    ["SE", 135, 315, -7.0711, 7.0711],
    ["S", 180, 0, 0, 10],
    ["SO", 225, 45, 7.0711, 7.0711],
    ["O", 270, 90, 10, 0],
    ["NO", 315, 135, 7.0711, -7.0711],
  ];
  it.each(cases)("viento del %s (%i°) va hacia el rumbo %i°", (_n, from, heading, u, v) => {
    const w = windToVector(10, from);
    near(w.u, u, 1e-3);
    near(w.v, v, 1e-3);
    near(vectorHeading(w), heading, 1e-6);
  });

  it("360° equivale a 0° y la velocidad es el módulo", () => {
    const a = windToVector(7, 360);
    const b = windToVector(7, 0);
    near(a.u, b.u, 1e-9);
    near(a.v, b.v, 1e-9);
    near(Math.hypot(a.u, a.v), 7);
  });

  it("calma: vector nulo sin -0", () => {
    const w = windToVector(0, 90);
    expect(Object.is(w.u, -0)).toBe(false);
    expect(Object.is(w.v, -0)).toBe(false);
  });
});

describe("unidades", () => {
  it("normaliza a m/s y rechaza las desconocidas", () => {
    expect(toMetresPerSecond(10, "m/s")).toBe(10);
    near(toMetresPerSecond(36, "km/h") ?? NaN, 10);
    near(toMetresPerSecond(10, "kt") ?? NaN, 5.14444, 1e-4);
    expect(toMetresPerSecond(10, "bft")).toBeNull();
  });
});

const stations = {
  A: { name: "A", lon: -8.4, lat: 43.37 },
  B: { name: "B", lon: -8.5, lat: 43.37 },
};
const speed = (id: string, value: number, ts = T0) => wind(id, { metric: "wind_speed", value, ts });
const dir = (id: string, value: number, ts = T0) =>
  wind(id, { metric: "wind_dir", value, unit: "deg", ts });

describe("buildSamples", () => {
  it("une velocidad y dirección por estación conocida", () => {
    const s = buildSamples([speed("A", 10), dir("A", 270)], T0, stations);
    expect(s).toHaveLength(1);
    near(s[0]?.u ?? NaN, 10);
    near(s[0]?.lon ?? NaN, -8.4);
  });

  it("descarta estaciones desconocidas, datos incompletos, caducados e inválidos", () => {
    const items = [
      speed("X", 5),
      dir("X", 90), // estación sin posición
      speed("A", 5), // sin dirección
      speed("B", 5),
      dir("B", 400), // fuera de rango
    ];
    expect(buildSamples(items, T0, stations)).toEqual([]);
    expect(
      buildSamples([speed("A", 5), dir("A", 90)], T0 + MAX_SAMPLE_AGE_MS + 1, stations),
    ).toEqual([]);
    expect(buildSamples([speed("A", Number.NaN), dir("A", 90)], T0, stations)).toEqual([]);
    expect(buildSamples([speed("A", -1), dir("A", 90)], T0, stations)).toEqual([]);
  });

  it("acepta datos justo dentro de la edad máxima y datos «del futuro»", () => {
    expect(
      buildSamples([speed("A", 5, T0), dir("A", 90, T0)], T0 + MAX_SAMPLE_AGE_MS, stations),
    ).toHaveLength(1);
    expect(
      buildSamples([speed("A", 5, T0 + 5000), dir("A", 90, T0 + 5000)], T0, stations),
    ).toHaveLength(1);
  });

  it("ignora observaciones que no son viento", () => {
    const temp = wind("A", { metric: "temperature", value: 12, unit: "degC" });
    expect(buildSamples([temp], T0, stations)).toEqual([]);
  });
});

const sample = (
  id: string,
  lon: number,
  lat: number,
  speedMs: number,
  from: number,
): WindSample => ({
  stationId: id,
  lon,
  lat,
  ...windToVector(speedMs, from),
});

describe("campo IDW", () => {
  it("sin muestras está vacío", () => {
    const f = createWindField([]);
    expect(f.empty).toBe(true);
    expect(f.sample(-8.4, 43.37).confidence).toBe(0);
  });

  it("sobre una estación vale su dato exacto", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 6, 270), sample("B", -8.5, 43.37, 2, 0)]);
    const v = f.sample(-8.4, 43.37);
    near(v.u, 6);
    near(v.v, 0);
    expect(v.confidence).toBe(1);
  });

  it("con una sola estación el campo es uniforme", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 6, 270)]);
    for (const [x, y] of [
      [-8.45, 43.33],
      [-8.35, 43.41],
    ] as const) {
      const v = f.sample(x, y);
      near(v.u, 6);
      near(v.v, 0);
    }
  });

  it("a medio camino de dos estaciones iguales en módulo da la media de los vectores", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 4, 270), sample("B", -8.5, 43.37, 4, 270)]);
    const v = f.sample(-8.45, 43.37);
    near(v.u, 4, 1e-6);
  });

  it("no crea velocidad nueva: nunca supera la mayor medida, ni en el borde de la zona", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 3, 200), sample("B", -8.5, 43.37, 9, 330)]);
    for (let lon = COVERAGE.west; lon <= COVERAGE.east; lon += 0.01) {
      for (let lat = COVERAGE.south; lat <= COVERAGE.north; lat += 0.01) {
        const v = f.sample(lon, lat);
        expect(Math.hypot(v.u, v.v)).toBeLessThanOrEqual(9 + 1e-9);
      }
    }
  });

  it("promedia componentes, no ángulos: 350° y 10° dan norte, no sur", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 5, 350), sample("B", -8.5, 43.37, 5, 10)]);
    const v = f.sample(-8.45, 43.37);
    // Viento del norte: el aire va hacia el sur (v < 0) y casi sin componente este-oeste.
    expect(v.v).toBeLessThan(-4.9);
    near(v.u, 0, 1e-6);
  });

  it("la confianza cae con la distancia a la estación más cercana", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 5, 270)]);
    const kx = 111_320 * Math.cos((43.37 * Math.PI) / 180);
    const at = (m: number) => f.sample(-8.4 + m / kx, 43.37).confidence;
    expect(at(FULL_CONFIDENCE_M - 1)).toBe(1);
    near(at((FULL_CONFIDENCE_M + NO_CONFIDENCE_M) / 2), 0.5, 1e-3);
    expect(at(NO_CONFIDENCE_M + 1)).toBe(0);
  });

  it("reutiliza el objeto de salida", () => {
    const f = createWindField([sample("A", -8.4, 43.37, 5, 270)]);
    const out = { u: 0, v: 0, confidence: 0 };
    expect(f.sample(-8.41, 43.37, out)).toBe(out);
  });
});

describe("cobertura", () => {
  it("limita a la zona de A Coruña", () => {
    expect(inCoverage(-8.41, 43.37)).toBe(true);
    expect(inCoverage(-8.53, 43.347)).toBe(false); // Langosteira queda fuera: solo aporta su dato
    expect(inCoverage(-8.41, 43.5)).toBe(false);
    expect(inCoverage(-8.2, 43.37)).toBe(false);
  });
});
