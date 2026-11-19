import { describe, expect, it } from "vitest";
import { GROUND_ALPHA, GROUND_SIZE, SIZE_MAX, SIZE_MIN, iconAlpha, iconSize } from "./style";

describe("estilo de aviones", () => {
  it("el tamaño crece sutilmente con la altitud y se acota", () => {
    expect(iconSize(undefined, false)).toBe(SIZE_MIN);
    expect(iconSize(0, false)).toBe(SIZE_MIN);
    expect(iconSize(5000, false)).toBeCloseTo((SIZE_MIN + SIZE_MAX) / 2, 9);
    expect(iconSize(12_000, false)).toBe(SIZE_MAX);
    expect(iconSize(-50, false)).toBe(SIZE_MIN);
  });

  it("en tierra es más pequeño y más tenue", () => {
    expect(iconSize(0, true)).toBe(GROUND_SIZE);
    expect(GROUND_SIZE).toBeLessThan(SIZE_MIN);
    expect(iconAlpha(true, 1)).toBe(Math.round(255 * GROUND_ALPHA));
    expect(iconAlpha(false, 1)).toBe(255);
    expect(iconAlpha(false, 0.5)).toBe(128);
  });
});
