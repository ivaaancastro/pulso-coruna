import { describe, expect, it, vi } from "vitest";
import { buildAdapters } from "../src/registry.js";

describe("registry", () => {
  it("registra BiciCoruña, MeteoGalicia y el estimador por horario, sin iTranvías", () => {
    const ids = buildAdapters({}).map((a) => a.id);
    expect(ids).toEqual(["bicicoruna", "meteogalicia", "bus-schedule"]);
  });

  it("solo ITRANVIAS_ENABLED=true exacto añade iTranvías", () => {
    expect(buildAdapters({ ITRANVIAS_ENABLED: "1" })).toHaveLength(3);
    expect(buildAdapters({ ITRANVIAS_ENABLED: "true" })).toHaveLength(4);
  });

  it("SCHEDULE_ESTIMATES_ENABLED=false desactiva el estimador por horario", () => {
    const ids = buildAdapters({ SCHEDULE_ESTIMATES_ENABLED: "false" }).map((a) => a.id);
    expect(ids).toEqual(["bicicoruna", "meteogalicia"]);
    expect(buildAdapters({ SCHEDULE_ESTIMATES_ENABLED: "true" })).toHaveLength(3);
  });

  it("los ids son únicos", () => {
    const ids = buildAdapters({ ITRANVIAS_ENABLED: "true" }).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("barcos: solo con AISSTREAM_API_KEY y SHIP_ID_SALT; sin ellas avisa y no rompe", () => {
    const warn = vi.fn();
    const logger = { info() {}, warn, error() {} };
    expect(buildAdapters({}, logger).map((a) => a.id)).not.toContain("aisstream");
    expect(warn).toHaveBeenCalledWith("barcos (aisstream) desactivados", {
      reason: expect.stringContaining("AISSTREAM_API_KEY"),
    });
    expect(buildAdapters({ AISSTREAM_API_KEY: "k" }, logger).map((a) => a.id)).not.toContain(
      "aisstream",
    );
    const all = buildAdapters({ AISSTREAM_API_KEY: "k", SHIP_ID_SALT: "s" }, logger);
    expect(all.map((a) => a.id)).toContain("aisstream");
    // Crear el adaptador no abre ningún socket (se abre en el primer ciclo).
    all.forEach((a) => void a.close?.());
  });
});
