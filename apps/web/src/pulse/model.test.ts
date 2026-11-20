import { describe, expect, it } from "vitest";
import {
  PULSE_STEP_MS,
  PULSE_WINDOW_MS,
  deriveSnapshot,
  pulseWindow,
  seriesStats,
  type PulseData,
} from "./model";

const NOW = Date.parse("2026-11-19T12:03:27Z");

function dataFor(now: number, values: number[], endAt = now): PulseData {
  const w = pulseWindow(now);
  const last = Math.floor(endAt / PULSE_STEP_MS) * PULSE_STEP_MS;
  const points = values.map((value, i) => ({
    ts: last - (values.length - 1 - i) * PULSE_STEP_MS,
    value,
    layers: {},
  }));
  return { ...w, profile: "fixed", points };
}

describe("ventana", () => {
  it("24 h que terminan al cierre del paso en curso, con from alineado al paso", () => {
    const w = pulseWindow(NOW);
    expect(w.to - w.from).toBe(PULSE_WINDOW_MS);
    expect(w.from % PULSE_STEP_MS).toBe(0);
    expect(w.to).toBe(Date.parse("2026-11-19T12:05:00Z"));
    expect(w.stepMs).toBe(PULSE_STEP_MS);
    expect(w.from).toBeLessThanOrEqual(NOW);
  });

  it("todos los instantes de un mismo paso comparten ventana (caché compartida)", () => {
    const a = pulseWindow(Date.parse("2026-11-19T12:00:00Z"));
    const b = pulseWindow(Date.parse("2026-11-19T12:04:59.999Z"));
    expect(a).toEqual(b);
    expect(pulseWindow(Date.parse("2026-11-19T12:05:00Z")).to).toBe(a.to + PULSE_STEP_MS);
  });
});

describe("estado", () => {
  it("sin datos ni fallo: cargando; con fallo: error o sin datos", () => {
    expect(deriveSnapshot(null, null, NOW).status).toBe("loading");
    expect(deriveSnapshot(null, "error", NOW)).toMatchObject({ status: "error", value: null });
    expect(deriveSnapshot(null, "nodata", NOW).status).toBe("nodata");
  });

  it("listo: el valor es el último punto y el perfil fijo se propaga", () => {
    const s = deriveSnapshot(dataFor(NOW, [40, 42.5, 47.1]), null, NOW);
    expect(s).toMatchObject({ status: "ready", value: 47.1, profile: "fixed" });
    expect(s.points).toHaveLength(3);
  });

  it("no enseña el futuro: en Reproducir el valor es el último punto ≤ t", () => {
    const d = dataFor(NOW, [10, 20, 30, 40]);
    const t = (d.points[1] as { ts: number }).ts + 1000;
    const s = deriveSnapshot(d, null, t);
    expect(s.value).toBe(20);
    expect(s.points.map((p) => p.value)).toEqual([10, 20]);
  });

  it("punto viejo (> 15 min): atenuado como «stale»", () => {
    const d = dataFor(NOW, [50, 51], NOW - 40 * 60_000);
    expect(deriveSnapshot(d, null, NOW)).toMatchObject({ status: "stale", value: 51 });
  });

  it("ventana sin ningún punto hasta t: sin datos", () => {
    const d: PulseData = { ...pulseWindow(NOW), profile: "learned", points: [] };
    expect(deriveSnapshot(d, null, NOW)).toMatchObject({ status: "nodata", value: null });
  });

  it("datos que no cubren t (se saltó a otro día): cargando, no un valor equivocado", () => {
    const d = dataFor(NOW, [50]);
    const far = NOW - 3 * 86_400_000;
    expect(deriveSnapshot(d, null, far)).toMatchObject({ status: "loading", value: null });
  });

  it("al cambiar de paso se sigue mostrando la ventana anterior (sin parpadeo)", () => {
    const d = dataFor(NOW, [50, 52]);
    const next = d.to + 20_000;
    expect(deriveSnapshot(d, null, next)).toMatchObject({ status: "ready", value: 52 });
  });
});

describe("estadísticas", () => {
  it("mínimo, máximo y último", () => {
    const pts = [30, 80, 55].map((value, i) => ({ ts: i, value, layers: {} }));
    expect(seriesStats(pts)).toEqual({ min: 30, max: 80, last: 55 });
    expect(seriesStats([])).toBeNull();
  });
});
