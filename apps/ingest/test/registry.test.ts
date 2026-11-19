import { describe, expect, it } from "vitest";
import { buildAdapters } from "../src/registry.js";

describe("registry", () => {
  it("registra BiciCoruña, MeteoGalicia, aire (modelo) y el estimador por horario, sin iTranvías", () => {
    const ids = buildAdapters({}).map((a) => a.id);
    expect(ids).toEqual(["bicicoruna", "meteogalicia", "openmeteo-air", "bus-schedule"]);
  });

  it("solo ITRANVIAS_ENABLED=true exacto añade iTranvías", () => {
    expect(buildAdapters({ ITRANVIAS_ENABLED: "1" })).toHaveLength(4);
    expect(buildAdapters({ ITRANVIAS_ENABLED: "true" })).toHaveLength(5);
  });

  it("SCHEDULE_ESTIMATES_ENABLED=false desactiva el estimador por horario", () => {
    const ids = buildAdapters({ SCHEDULE_ESTIMATES_ENABLED: "false" }).map((a) => a.id);
    expect(ids).toEqual(["bicicoruna", "meteogalicia", "openmeteo-air"]);
    expect(buildAdapters({ SCHEDULE_ESTIMATES_ENABLED: "true" })).toHaveLength(4);
  });

  it("OPENMETEO_AIR_ENABLED=false desactiva el aire modelado", () => {
    const ids = buildAdapters({ OPENMETEO_AIR_ENABLED: "false" }).map((a) => a.id);
    expect(ids).not.toContain("openmeteo-air");
  });

  it("los ids son únicos", () => {
    const ids = buildAdapters({ ITRANVIAS_ENABLED: "true" }).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
