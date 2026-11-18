import { describe, expect, it } from "vitest";
import { backoffDelay } from "../src/backoff.js";
import { loadConfig } from "../src/config.js";
import { nextHealth, statusFor } from "../src/health.js";
import { validateRows } from "../src/validate.js";
import { bus, station, wind } from "./helpers.js";

describe("backoffDelay", () => {
  const opts = { baseMs: 1000, maxMs: 10_000 };
  it("crece exponencialmente hasta el tope (sin jitter con random=1)", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, opts, () => 1))).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000,
    ]);
  });
  it("el jitter queda entre el 50 % y el 100 % del valor", () => {
    expect(backoffDelay(3, opts, () => 0)).toBe(2000);
    expect(backoffDelay(3, opts, () => 0.5)).toBe(3000);
    for (let i = 0; i < 100; i++) {
      const d = backoffDelay(4, opts);
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });
});

describe("loadConfig", () => {
  it("exige DATABASE_URL y aplica valores por defecto", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(loadConfig({ DATABASE_URL: "postgres://x" })).toMatchObject({
      timeoutMs: 15_000,
      maxAttempts: 3,
      downAfter: 3,
    });
  });
  it("rechaza valores no válidos", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", INGEST_MAX_ATTEMPTS: "0" })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: "x", INGEST_TIMEOUT_MS: "abc" })).toThrow();
    expect(() =>
      loadConfig({
        DATABASE_URL: "x",
        INGEST_BACKOFF_BASE_MS: "5000",
        INGEST_BACKOFF_MAX_MS: "1000",
      }),
    ).toThrow();
  });
});

describe("estado de salud", () => {
  it("ok / degraded / down según fallos consecutivos", () => {
    expect([0, 1, 2, 3, 9].map((n) => statusFor(n, 3))).toEqual([
      "ok",
      "degraded",
      "degraded",
      "down",
      "down",
    ]);
  });
  it("un éxito conserva el último error pero reinicia los fallos", () => {
    const base = { sourceId: "s", intervalMs: 1000, latencyMs: 5, rowsWritten: 2, rowsRejected: 0 };
    const failed = nextHealth(
      null,
      { ...base, at: 10, ok: false, latencyMs: null, rowsWritten: 0, error: "x" },
      3,
    );
    const healed = nextHealth(failed, { ...base, at: 20, ok: true }, 3);
    expect(healed).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
      lastSuccessAt: 20,
      lastErrorAt: 10,
      lastError: "x",
      rowsWrittenTotal: 2,
    });
  });
});

describe("validateRows", () => {
  it("enruta por capa y descarta filas que rompen el contrato", () => {
    const r = validateRows([
      bus("1"),
      station("a"),
      wind("w"),
      { ...bus("2"), lat: 999 },
      { ...bus("3"), ts: 1_700_000_000 }, // segundos
      { ...bus("4"), extra: 1 }, // clave desconocida
      { id: "x", layer: "nope" },
      null,
    ]);
    expect(r.valid.positions).toHaveLength(1);
    expect(r.valid.stations).toHaveLength(1);
    expect(r.valid.observations).toHaveLength(1);
    expect(r.rejected).toBe(5);
    expect(r.firstError).toBeTruthy();
  });
});
