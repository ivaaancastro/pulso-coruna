import { describe, expect, it } from "vitest";
import { mixHex, paletteAt, phaseFor, type MapPalette } from "./palette";

const at = (iso: string): MapPalette => paletteAt(Date.parse(iso));

describe("phaseFor", () => {
  it("decide por elevación y sentido del día", () => {
    expect(phaseFor(-20, true)).toBe("night");
    expect(phaseFor(0, true)).toBe("dawn");
    expect(phaseFor(0, false)).toBe("dusk");
    expect(phaseFor(30, false)).toBe("day");
  });
});

describe("paletteAt", () => {
  it("de noche usa exactamente los tokens aprobados", () => {
    const p = at("2026-11-18T23:30:00Z");
    expect(p.phase).toBe("night");
    expect(p.bg).toBe("#05080e");
    expect(p.land).toBe("#0a0f19");
    expect(p.water).toBe("#0b2236");
    expect(p.coast).toBe("#1e3a55");
    expect(p.building).toBe("#1a2438");
  });

  it("recorre noche, amanecer, día, atardecer y noche en un día de noviembre", () => {
    const phases: string[] = [];
    for (let m = 0; m < 24 * 60; m += 10) {
      const phase = paletteAt(Date.parse("2026-11-18T00:00:00Z") + m * 60_000).phase;
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    }
    expect(phases).toEqual(["night", "dawn", "day", "dusk", "night"]);
  });

  it("depende solo del instante UTC, también en invierno y verano", () => {
    expect(at("2026-01-15T12:00:00Z").phase).toBe("day");
    expect(at("2026-07-15T12:00:00Z").phase).toBe("day");
    expect(at("2026-01-15T22:00:00Z").phase).toBe("night");
    // 22:30 hora de verano (20:30 UTC) aún no es noche cerrada; en invierno a esa hora ya sí.
    expect(at("2026-07-15T20:30:00Z").phase).not.toBe("night");
  });

  it("el mapa siempre es oscuro: ningún color base se acerca a la luminancia de una entidad", () => {
    const luma = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    };
    for (const iso of [
      "2026-11-18T03:00:00Z",
      "2026-11-18T07:00:00Z",
      "2026-11-18T12:30:00Z",
      "2026-11-18T17:20:00Z",
    ]) {
      const p = at(iso);
      for (const c of [p.bg, p.land, p.water, p.building, p.buildingTall, p.road, p.roadMajor]) {
        expect(luma(c), `${iso} ${c}`).toBeLessThan(0.35);
      }
    }
  });

  it("es continua: sin saltos de color entre minutos consecutivos", () => {
    const start = Date.parse("2026-11-18T00:00:00Z");
    const channel = (hex: string, i: number): number =>
      Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    let prev = paletteAt(start);
    for (let m = 1; m <= 24 * 60; m++) {
      const next = paletteAt(start + m * 60_000);
      for (const key of ["bg", "land", "water", "building", "coast"] as const) {
        for (let i = 0; i < 3; i++) {
          const jump = Math.abs(channel(next[key], i) - channel(prev[key], i));
          expect(jump, `${key} min ${m}`).toBeLessThanOrEqual(4);
        }
      }
      expect(Math.abs(next.light.polar - prev.light.polar)).toBeLessThan(3);
      prev = next;
    }
  });

  it("la luz de día cae según el sol y es más intensa que la de noche", () => {
    const night = at("2026-11-18T23:30:00Z");
    const day = at("2026-11-18T12:30:00Z");
    expect(day.light.intensity).toBeGreaterThan(night.light.intensity);
    expect(day.light.polar).toBeLessThan(night.light.polar);
    expect(day.light.azimuth).toBeGreaterThan(150);
    expect(day.light.azimuth).toBeLessThan(210);
  });
});

describe("mixHex", () => {
  it("interpola canal a canal", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.3)).toBe("#102030");
  });
});
