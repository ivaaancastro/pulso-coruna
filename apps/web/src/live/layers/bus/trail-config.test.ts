import { describe, expect, it } from "vitest";
import { MAX_TRAIL_MS, TRAIL_PRESETS, TrailConfig } from "./trail-config";

describe("TrailConfig (calidad y longitud de estelas)", () => {
  it("empieza en calidad alta con estela de 20–30 s (direccion.md)", () => {
    const c = new TrailConfig();
    expect(c.quality).toBe("high");
    expect(c.settings.lengthMs).toBeGreaterThanOrEqual(20_000);
    expect(c.settings.lengthMs).toBeLessThanOrEqual(30_000);
  });

  it("la calidad baja acorta las estelas y espacia los vértices", () => {
    const { high, medium, low } = TRAIL_PRESETS;
    expect(high.lengthMs).toBeGreaterThan(medium.lengthMs);
    expect(medium.lengthMs).toBeGreaterThan(low.lengthMs);
    expect(high.sampleMs).toBeLessThan(low.sampleMs);
  });

  it("degrade baja un nivel por vez y se detiene en el más bajo; improve sube", () => {
    const c = new TrailConfig();
    expect(c.degrade()).toBe(true);
    expect(c.quality).toBe("medium");
    expect(c.degrade()).toBe(true);
    expect(c.quality).toBe("low");
    expect(c.degrade()).toBe(false);
    expect(c.quality).toBe("low");
    expect(c.improve()).toBe(true);
    expect(c.quality).toBe("medium");
    c.setQuality("high");
    expect(c.improve()).toBe(false);
  });

  it("la longitud propia manda sobre el preset, se acota y se puede quitar", () => {
    const c = new TrailConfig("medium");
    c.setLengthMs(8000);
    expect(c.settings.lengthMs).toBe(8000);
    expect(c.settings.sampleMs).toBe(TRAIL_PRESETS.medium.sampleMs);
    c.setLengthMs(10 * MAX_TRAIL_MS);
    expect(c.settings.lengthMs).toBe(MAX_TRAIL_MS);
    c.setLengthMs(-5);
    expect(c.settings.lengthMs).toBe(0);
    c.setLengthMs(Number.NaN);
    expect(c.lengthOverrideMs).toBeNull();
    expect(c.settings.lengthMs).toBe(TRAIL_PRESETS.medium.lengthMs);
  });

  it("cambiar de calidad descarta la longitud propia", () => {
    const c = new TrailConfig();
    c.setLengthMs(3000);
    c.degrade();
    expect(c.settings.lengthMs).toBe(TRAIL_PRESETS.medium.lengthMs);
  });
});
