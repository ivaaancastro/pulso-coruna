import { describe, expect, it } from "vitest";
import { pixelRatioFor } from "./pixel-ratio";

describe("pixelRatioFor", () => {
  it("respeta el dpr real hasta el tope del nivel", () => {
    expect(pixelRatioFor(1)).toBe(1);
    expect(pixelRatioFor(2)).toBe(2);
    expect(pixelRatioFor(3)).toBe(3);
    expect(pixelRatioFor(4)).toBe(3);
  });
  it("degrada con el auto-quality", () => {
    expect(pixelRatioFor(3, "medium")).toBe(2);
    expect(pixelRatioFor(3, "low")).toBe(1.5);
    expect(pixelRatioFor(1, "low")).toBe(1);
  });
  it("tolera valores no válidos", () => {
    expect(pixelRatioFor(0)).toBe(1);
    expect(pixelRatioFor(Number.NaN)).toBe(1);
  });
});
