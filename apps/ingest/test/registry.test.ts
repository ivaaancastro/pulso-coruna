import { describe, expect, it } from "vitest";
import { buildAdapters } from "../src/registry.js";

describe("registry", () => {
  it("registra BiciCoruña y MeteoGalicia por defecto, sin iTranvías", () => {
    const ids = buildAdapters({}).map((a) => a.id);
    expect(ids).toEqual(["bicicoruna", "meteogalicia"]);
  });

  it("solo ITRANVIAS_ENABLED=true exacto añade iTranvías", () => {
    expect(buildAdapters({ ITRANVIAS_ENABLED: "1" })).toHaveLength(2);
    expect(buildAdapters({ ITRANVIAS_ENABLED: "true" })).toHaveLength(3);
  });

  it("los ids son únicos", () => {
    const ids = buildAdapters({ ITRANVIAS_ENABLED: "true" }).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
