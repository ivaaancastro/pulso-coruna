import { describe, expect, it } from "vitest";
import { addMadridDays, madridDayEnd, madridDayStart, recentDays } from "./day";

const H = 3_600_000;

describe("días de Madrid", () => {
  it("invierno: la medianoche local es 23:00 UTC del día anterior", () => {
    const start = madridDayStart(Date.parse("2026-11-18T12:00:00Z"));
    expect(new Date(start).toISOString()).toBe("2026-11-17T23:00:00.000Z");
    expect(madridDayEnd(start) - start).toBe(24 * H);
  });

  it("verano: la medianoche local es 22:00 UTC del día anterior", () => {
    const start = madridDayStart(Date.parse("2026-07-10T12:00:00Z"));
    expect(new Date(start).toISOString()).toBe("2026-07-09T22:00:00.000Z");
  });

  it("el día es de Madrid, no de UTC (23:30 UTC ya es mañana)", () => {
    const a = madridDayStart(Date.parse("2026-11-18T22:59:00Z"));
    const b = madridDayStart(Date.parse("2026-11-18T23:01:00Z"));
    expect(b - a).toBe(24 * H);
  });

  it("cambio de hora de primavera (29 mar 2026): el día dura 23 h", () => {
    const start = madridDayStart(Date.parse("2026-03-29T10:00:00Z"));
    expect(new Date(start).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(madridDayEnd(start) - start).toBe(23 * H);
  });

  it("cambio de hora de otoño (25 oct 2026): el día dura 25 h", () => {
    const start = madridDayStart(Date.parse("2026-10-25T10:00:00Z"));
    expect(new Date(start).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(madridDayEnd(start) - start).toBe(25 * H);
  });

  it("addMadridDays suma días de calendario", () => {
    const start = madridDayStart(Date.parse("2026-03-28T12:00:00Z"));
    expect(new Date(addMadridDays(start, 1)).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(new Date(addMadridDays(start, 2)).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(addMadridDays(addMadridDays(start, 5), -5)).toBe(start);
  });

  it("recentDays: hoy primero, consecutivos y descendentes", () => {
    const now = Date.parse("2026-11-18T09:00:00Z");
    const days = recentDays(now, 30);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe(madridDayStart(now));
    for (let i = 1; i < days.length; i++) {
      expect(madridDayEnd(days[i] as number)).toBe(days[i - 1]);
    }
  });
});
