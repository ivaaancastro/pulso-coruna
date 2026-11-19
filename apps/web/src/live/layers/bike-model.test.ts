import { describe, expect, it } from "vitest";
import { bus, station } from "../test-helpers";
import {
  BIKE_RGB,
  FOCUS_RGB,
  MUTED_OPACITY,
  RING_RADIUS,
  TRANSITION_MS,
  easeOut,
  fillFraction,
  fillRadius,
  ringData,
  ringWidth,
  stationOpacity,
  stationState,
  transitionFor,
  withAlpha,
} from "./bike-model";

describe("fillFraction", () => {
  it("es bikes / (bikes + docks)", () => {
    expect(fillFraction({ bikes: 5, docks: 15 })).toBe(0.25);
    expect(fillFraction({ bikes: 10, docks: 0 })).toBe(1);
    expect(fillFraction({ bikes: 0, docks: 10 })).toBe(0);
  });
  it("0 bicis y 0 huecos no divide por cero", () => {
    expect(fillFraction({ bikes: 0, docks: 0 })).toBe(0);
  });
});

describe("stationState", () => {
  it.each([
    [{ bikes: 0, docks: 0 }, "out"],
    [{ bikes: 0, docks: 9 }, "empty"],
    [{ bikes: 9, docks: 0 }, "full"],
    [{ bikes: 1, docks: 1 }, "normal"],
  ] as const)("%o -> %s", (s, expected) => {
    expect(stationState(s)).toBe(expected);
  });
});

describe("forma y atenuación (no solo color)", () => {
  it("vacía y llena tienen grosor distinto entre sí y respecto a normal", () => {
    const widths = new Set([ringWidth("empty"), ringWidth("normal"), ringWidth("full")]);
    expect(widths.size).toBe(3);
    expect(ringWidth("empty")).toBeLessThan(ringWidth("normal"));
    expect(ringWidth("full")).toBeGreaterThan(ringWidth("normal"));
  });
  it("solo fuera de servicio se atenúa, con el token de capa sin dato", () => {
    expect(stationOpacity("out")).toBe(MUTED_OPACITY);
    expect(MUTED_OPACITY).toBe(0.35);
    for (const s of ["empty", "full", "normal"] as const) expect(stationOpacity(s)).toBe(1);
  });
});

describe("fillRadius", () => {
  it("el área es proporcional a la fracción", () => {
    const half = fillRadius(0.5, 2);
    const full = fillRadius(1, 2);
    expect(half ** 2 / full ** 2).toBeCloseTo(0.5, 10);
  });
  it("vacío = 0 y lleno cabe dentro del aro sin pisar el trazo", () => {
    expect(fillRadius(0, 2)).toBe(0);
    expect(fillRadius(1, 4)).toBeLessThan(RING_RADIUS - 4 / 2);
  });
  it("satura fuera de rango", () => {
    expect(fillRadius(7, 2)).toBe(fillRadius(1, 2));
    expect(fillRadius(-1, 2)).toBe(0);
  });
});

describe("withAlpha y colores de tokens", () => {
  it("usa exactamente --pulso-bike y --pulso-focus", () => {
    expect(BIKE_RGB).toEqual([0x6b, 0xe8, 0xa4]);
    expect(FOCUS_RGB).toEqual([0xf5, 0xf1, 0xe4]);
  });
  it("redondea y satura el alfa", () => {
    expect(withAlpha(BIKE_RGB, 0.35)).toEqual([107, 232, 164, 89]);
    expect(withAlpha(BIKE_RGB, 2)[3]).toBe(255);
    expect(withAlpha(BIKE_RGB, -1)[3]).toBe(0);
  });
});

describe("ringData", () => {
  it("ignora lo que no es una estación y marca la seleccionada", () => {
    const items = [
      station("a", { bikes: 5, docks: 5 }),
      station("b", { bikes: 0, docks: 0 }),
      bus("x"),
    ];
    const data = ringData(items, "a");
    expect(data.map((d) => d.id)).toEqual(["a", "b"]);
    expect(data[0]).toMatchObject({ state: "normal", selected: true, alpha: 255 });
    expect(data[1]).toMatchObject({ state: "out", selected: false, fillRadius: 0 });
    expect(data[1]?.alpha).toBe(Math.round(255 * MUTED_OPACITY));
  });
  it("conserva la posición lon, lat", () => {
    const [d] = ringData([station("a", { lon: -8.41, lat: 43.37 })]);
    expect(d?.position).toEqual([-8.41, 43.37]);
  });
});

describe("transición", () => {
  it("con reduced-motion no hay transición (cambio directo)", () => {
    expect(transitionFor(true)).toBeUndefined();
  });
  it("sin reduced-motion dura --pulso-dur-slow con ease-out", () => {
    const t = transitionFor(false);
    expect(t?.duration).toBe(TRANSITION_MS);
    expect(TRANSITION_MS).toBe(600);
    expect(t?.easing(0)).toBe(0);
    expect(t?.easing(1)).toBe(1);
  });
  it("easeOut es monótona y va por encima de la recta", () => {
    let prev = 0;
    for (let i = 1; i <= 10; i++) {
      const v = easeOut(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(i / 10);
      prev = v;
    }
  });
});
