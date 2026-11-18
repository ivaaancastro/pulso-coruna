import { describe, expect, it } from "vitest";
import { createNow, parseTimeOverride } from "./now";

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
  it("en desarrollo (vitest) fija el reloj", () => {
    expect(createNow("?t=2026-11-18T22:30:00Z")()).toBe(Date.parse("2026-11-18T22:30:00Z"));
  });

  it("sin parámetro devuelve Date.now", () => {
    expect(createNow("")).toBe(Date.now);
  });
});
