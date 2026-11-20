import { describe, expect, it } from "vitest";
import { observationsAt, tickAt } from "../scripts/synthetic.js";
import { validateRows } from "../src/validate.js";

const T0 = Date.parse("2026-11-18T10:00:00Z"); // múltiplo de 1 h

describe("datos sintéticos de la puerta de M6", () => {
  it("todo lo que genera cumple el contrato (Entity, StationStatus, Observation)", () => {
    for (const t of [T0, T0 + 15_000, T0 + 30_000, T0 + 60_000, T0 + 300_000]) {
      const k = tickAt(t);
      const v = validateRows([...k.positions, ...k.stations, ...k.observations]);
      expect(v.firstError).toBeNull();
      expect(v.rejected).toBe(0);
    }
  });

  it("es una función pura del instante y marca todo como sintético", () => {
    expect(tickAt(T0)).toEqual(tickAt(T0));
    const k = tickAt(T0);
    expect(k.positions.length).toBeGreaterThan(20);
    for (const e of k.positions) {
      expect(e.id.startsWith("syn-")).toBe(true);
      expect(e.meta?.["synthetic"]).toBe(1);
    }
    expect(k.stations.every((s) => s.id.startsWith("syn-"))).toBe(true);
    expect(k.observations.every((o) => o.stationId.startsWith("syn-"))).toBe(true);
  });

  it("cadencias: bicis cada minuto, meteo/marea cada 5 min, aire cada hora; de noche no hay buses", () => {
    expect(tickAt(T0 + 15_000).stations).toHaveLength(0);
    expect(tickAt(T0 + 60_000).stations.length).toBeGreaterThan(0);
    const layers = (t: number): string[] => [...new Set(observationsAt(t).map((o) => o.layer))];
    expect(layers(T0)).toEqual(expect.arrayContaining(["weather", "sea", "air"]));
    expect(layers(T0 + 300_000)).toEqual(["weather", "sea"]);
    expect(observationsAt(T0 + 15_000)).toHaveLength(0);
    const night = Date.parse("2026-11-18T02:00:00Z");
    expect(tickAt(night).positions.some((e) => e.layer === "bus")).toBe(false);
    expect(tickAt(T0).positions.some((e) => e.layer === "bus")).toBe(true);
  });
});
