import { describe, expect, it } from "vitest";
import { sunPosition } from "./sun";

const at = (iso: string) => sunPosition(Date.parse(iso));

describe("sunPosition (A Coruña)", () => {
  it("mediodía solar de noviembre: ~27° al sur", () => {
    const s = at("2026-11-18T12:30:00Z");
    expect(s.elevation).toBeGreaterThan(24);
    expect(s.elevation).toBeLessThan(31);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(8);
  });

  it("mediodía solar de junio: ~70°", () => {
    const s = at("2026-06-21T12:30:00Z");
    expect(s.elevation).toBeGreaterThan(67);
    expect(s.elevation).toBeLessThan(72);
  });

  it("medianoche: sol bajo el horizonte", () => {
    expect(at("2026-11-18T00:30:00Z").elevation).toBeLessThan(-20);
  });

  it("amanece por el este y anochece por el oeste", () => {
    const am = at("2026-11-18T07:00:00Z");
    const pm = at("2026-11-18T17:00:00Z");
    expect(am.morning).toBe(true);
    expect(am.azimuth).toBeGreaterThan(90);
    expect(am.azimuth).toBeLessThan(135);
    expect(pm.morning).toBe(false);
    expect(pm.azimuth).toBeGreaterThan(225);
    expect(pm.azimuth).toBeLessThan(270);
  });
});
