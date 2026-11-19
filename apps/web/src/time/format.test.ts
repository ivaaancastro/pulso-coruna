import { describe, expect, it } from "vitest";
import { formatAgo, formatMadridDate, formatMadridTime, msToNextMinute } from "./format";

describe("formatAgo", () => {
  const T = Date.UTC(2026, 10, 18, 12, 0);
  it("menos de un minuto: «ahora»", () => {
    expect(formatAgo(T, T + 20_000, "es-ES")).toBe("ahora");
    expect(formatAgo(T, T + 20_000, "en-GB")).toBe("now");
  });
  it("minutos, horas y días", () => {
    expect(formatAgo(T, T + 2 * 60_000 + 5_000, "es-ES")).toMatch(/^hace 2 min/);
    expect(formatAgo(T, T + 3 * 3_600_000, "es-ES")).toMatch(/^hace 3 h/);
    expect(formatAgo(T, T + 3 * 86_400_000, "es-ES")).toMatch(/^hace 3 d/);
  });
  it("gallego e inglés", () => {
    expect(formatAgo(T, T + 5 * 60_000, "gl-ES")).toMatch(/5 min/);
    expect(formatAgo(T, T + 5 * 60_000, "en-GB")).toMatch(/5 min ago/);
  });
  it("reloj adelantado respecto al dato: nunca negativo", () => {
    expect(formatAgo(T + 60_000, T, "es-ES")).toBe("ahora");
  });
});

describe("formatMadridTime", () => {
  it("invierno: UTC+1", () => {
    expect(formatMadridTime(Date.UTC(2026, 0, 15, 22, 47))).toBe("23:47");
  });

  it("verano: UTC+2", () => {
    expect(formatMadridTime(Date.UTC(2026, 6, 15, 22, 47))).toBe("00:47");
  });

  it("medianoche local es 00:xx, nunca 24:xx", () => {
    expect(formatMadridTime(Date.UTC(2026, 0, 15, 23, 5))).toBe("00:05");
  });

  it("cambio de hora de marzo (salta 02:00 → 03:00)", () => {
    // 2026-03-29 01:30 UTC = 03:30 en Madrid (CEST)
    expect(formatMadridTime(Date.UTC(2026, 2, 29, 1, 30))).toBe("03:30");
  });

  it("no depende de la zona del sistema: mismo epoch, misma hora", () => {
    const epoch = Date.UTC(2026, 10, 18, 12, 0);
    expect(formatMadridTime(epoch)).toBe("13:00");
  });
});

describe("formatMadridDate", () => {
  it("usa el día de Madrid, no el de UTC", () => {
    // 23:30 UTC del 18 nov = 00:30 del 19 en Madrid
    expect(formatMadridDate(Date.UTC(2026, 10, 18, 23, 30))).toContain("19");
  });
});

describe("msToNextMinute", () => {
  it("calcula el resto hasta el minuto", () => {
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 59, 500))).toBe(500);
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 0, 0))).toBe(60_000);
  });
});
