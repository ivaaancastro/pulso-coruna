import { describe, expect, it } from "vitest";
import {
  EXTRAPOLATE_MAX_MS,
  FADE_START_MS,
  ageOpacity,
  canExtrapolate,
  estimate,
  offsetLonLat,
} from "./extrapolate";
import type { PlaneInfo } from "./meta";

const T0 = 1_760_000_000_000;
const plane = (over: Partial<PlaneInfo> = {}): PlaneInfo => ({
  id: "34324a",
  lon: -8.4,
  lat: 43.35,
  ts: T0,
  heading: 90,
  speed: 100,
  onGround: false,
  ...over,
});

describe("offsetLonLat", () => {
  it("norte aumenta la latitud, este aumenta la longitud (más por grado a esta latitud)", () => {
    const [lon0, lat0] = [-8.4, 43.35];
    const [, latN] = offsetLonLat(lon0, lat0, 0, 1000);
    expect(latN - lat0).toBeCloseTo(1000 / 111_320, 6);
    const [lonE, latE] = offsetLonLat(lon0, lat0, 90, 1000);
    expect(latE).toBeCloseTo(lat0, 9);
    expect(lonE - lon0).toBeCloseTo(1000 / (111_320 * Math.cos((lat0 * Math.PI) / 180)), 6);
    const [lonW] = offsetLonLat(lon0, lat0, 270, 1000);
    expect(lonW).toBeLessThan(lon0);
  });
});

describe("estimate", () => {
  it("en el instante del dato no se mueve", () => {
    const e = estimate(plane(), T0);
    expect(e).toMatchObject({ lon: -8.4, lat: 43.35, ageMs: 0, extrapolated: false, opacity: 1 });
  });

  it("avanza velocidad × tiempo en el rumbo dado", () => {
    const e = estimate(plane({ heading: 0, speed: 100 }), T0 + 60_000);
    expect(e.extrapolated).toBe(true);
    expect((e.lat - 43.35) * 111_320).toBeCloseTo(6000, 0);
    expect(e.lon).toBeCloseTo(-8.4, 9);
  });

  it("se detiene en el tope de 8 min y a partir de ahí es invisible", () => {
    const atMax = estimate(plane(), T0 + EXTRAPOLATE_MAX_MS);
    const later = estimate(plane(), T0 + EXTRAPOLATE_MAX_MS + 10 * 60_000);
    expect(later.lon).toBe(atMax.lon);
    expect(atMax.opacity).toBe(0);
    expect(later.opacity).toBe(0);
  });

  it("opacidad: plena hasta 6 min y lineal hasta 0 a los 8", () => {
    expect(ageOpacity(0)).toBe(1);
    expect(ageOpacity(FADE_START_MS)).toBe(1);
    expect(ageOpacity(7 * 60_000)).toBeCloseTo(0.5, 9);
    expect(ageOpacity(EXTRAPOLATE_MAX_MS)).toBe(0);
  });

  it("en tierra, sin rumbo, sin velocidad o casi parado no se extrapola", () => {
    const later = T0 + 120_000;
    for (const over of [
      { onGround: true },
      { heading: undefined },
      { speed: undefined },
      { speed: 1 },
    ] as Partial<PlaneInfo>[]) {
      const p = plane(over);
      expect(canExtrapolate(p)).toBe(false);
      expect(estimate(p, later)).toMatchObject({ lon: -8.4, lat: 43.35, extrapolated: false });
    }
  });

  it("un reloj anterior al dato no da edades negativas", () => {
    expect(estimate(plane(), T0 - 5000)).toMatchObject({ ageMs: 0, extrapolated: false });
  });
});
