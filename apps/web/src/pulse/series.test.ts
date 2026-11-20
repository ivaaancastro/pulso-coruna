import { describe, expect, it } from "vitest";
import { PULSE_STEP_MS } from "./model";
import { SERIES_H, SERIES_W, buildSeries, yFor } from "./series";

const FROM = 1_000_000_000_000;
const TO = FROM + 24 * 3_600_000;
const pt = (k: number, value: number) => ({ ts: FROM + k * PULSE_STEP_MS, value, layers: {} });

describe("serie → path", () => {
  it("sin puntos: path vacío y sin marca", () => {
    const g = buildSeries([], FROM, TO, PULSE_STEP_MS);
    expect(g).toMatchObject({ line: "", area: "", last: null });
  });

  it("y fijo 0–100: 50 queda a media altura y los extremos dentro del lienzo", () => {
    expect(yFor(50)).toBeCloseTo(SERIES_H / 2);
    expect(yFor(0)).toBeLessThanOrEqual(SERIES_H);
    expect(yFor(100)).toBeGreaterThanOrEqual(0);
    expect(yFor(150)).toBe(yFor(100));
    expect(yFor(-5)).toBe(yFor(0));
    expect(buildSeries([], FROM, TO, PULSE_STEP_MS).midY).toBeCloseTo(SERIES_H / 2);
  });

  it("puntos contiguos: un solo tramo M…L…, x creciente dentro del ancho", () => {
    const g = buildSeries([pt(0, 10), pt(1, 60), pt(2, 30)], FROM, TO, PULSE_STEP_MS);
    expect(g.line.match(/M/g)).toHaveLength(1);
    expect(g.line.match(/L/g)).toHaveLength(2);
    expect(g.area.endsWith("Z")).toBe(true);
    const xs = [...g.line.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.max(...xs)).toBeLessThanOrEqual(SERIES_W);
    expect(g.last?.y).toBeCloseTo(yFor(30), 0);
  });

  it("un hueco corta el trazo en lugar de unir con una recta inventada", () => {
    const g = buildSeries([pt(0, 10), pt(1, 20), pt(10, 80), pt(11, 70)], FROM, TO, PULSE_STEP_MS);
    expect(g.line.match(/M/g)).toHaveLength(2);
  });

  it("un punto aislado se dibuja como marca", () => {
    const g = buildSeries([pt(3, 40)], FROM, TO, PULSE_STEP_MS);
    expect(g.line).toContain("h0.01");
    expect(g.area).toBe("");
    expect(g.last).not.toBeNull();
  });
});
