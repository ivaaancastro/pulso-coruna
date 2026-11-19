import { afterEach, describe, expect, it } from "vitest";
import { createBaseNow, createNow, parseTimeOverride, setClockOverride } from "./now";

describe("parseTimeOverride", () => {
  it("acepta ISO con zona y epoch ms", () => {
    expect(parseTimeOverride("?t=2026-11-18T22:30:00Z")).toBe(Date.parse("2026-11-18T22:30:00Z"));
    expect(parseTimeOverride("?t=1795000000000")).toBe(1795000000000);
  });

  it("ignora ausencia o basura", () => {
    expect(parseTimeOverride("")).toBeNull();
    expect(parseTimeOverride("?t=mañana")).toBeNull();
  });
});

describe("createNow", () => {
  afterEach(() => setClockOverride(null));

  it("en desarrollo (vitest) fija el reloj", () => {
    expect(createNow("?t=2026-11-18T22:30:00Z")()).toBe(Date.parse("2026-11-18T22:30:00Z"));
  });

  it("sin parámetro devuelve la hora real", () => {
    const before = Date.now();
    const value = createNow("")();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
    expect(createBaseNow("")).toBe(Date.now);
  });

  it("el override (reloj de reproducción) manda sobre `?t=` y se puede quitar", () => {
    const now = createNow("?t=2026-11-18T22:30:00Z");
    setClockOverride(() => 42);
    expect(now()).toBe(42);
    setClockOverride(null);
    expect(now()).toBe(Date.parse("2026-11-18T22:30:00Z"));
  });
});
