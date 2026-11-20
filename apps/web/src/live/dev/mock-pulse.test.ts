import { PulseSchema } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { handleMockPulse, mockPulseValue } from "./mock-pulse";

const NOW = Date.parse("2026-11-19T12:03:27Z");
const TO = (Math.floor(NOW / 300_000) + 1) * 300_000;
const q = (o: Record<string, string>) => new URLSearchParams(o);
const win = { from: String(TO - 86_400_000), to: String(TO), step: "300000" };

describe("índice Pulso simulado", () => {
  it("la respuesta cumple PulseSchema, es determinista y no inventa el futuro", () => {
    const r = handleMockPulse(q(win), { now: NOW });
    expect(r.status).toBe(200);
    const parsed = PulseSchema.safeParse(r.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues[0])).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.profile).toBe("fixed");
    expect(parsed.data.points.length).toBeGreaterThan(200);
    expect(parsed.data.points.every((p) => p.ts <= NOW)).toBe(true);
    expect(handleMockPulse(q(win), { now: NOW })).toEqual(r);
  });

  it("curva diaria: la madrugada es más baja que la punta", () => {
    const night = mockPulseValue(Date.parse("2026-11-19T03:00:00Z"));
    const peak = mockPulseValue(Date.parse("2026-11-19T17:30:00Z"));
    expect(peak).toBeGreaterThan(night + 20);
  });

  it("valida la petición como el servidor real (400 sin cuerpo de datos)", () => {
    for (const bad of [
      { ...win, from: "1700000000" },
      { ...win, step: "1000" },
      { ...win, to: win.from },
      { ...win, from: String(TO - 90_000_000) },
      { ...win, from: String(NOW + 60_000) },
      { ...win, from: String(NOW - 20 * 86_400_000), to: String(NOW - 19 * 86_400_000) },
    ]) {
      const r = handleMockPulse(q(bad), { now: NOW });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.headers["Cache-Control"]).toBe("no-store");
    }
  });
});
