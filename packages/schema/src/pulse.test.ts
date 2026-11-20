import { describe, expect, it } from "vitest";
import { PULSE_MAX_WINDOW_MS, PulseSchema } from "./index.js";

const FROM = 1_760_000_100_000;
const STEP = 300_000;
const pulse = (over: Record<string, unknown> = {}): unknown => ({
  v: 1,
  from: FROM,
  to: FROM + 3 * STEP,
  stepMs: STEP,
  profile: "fixed",
  points: [
    { ts: FROM, value: 48.5, layers: { bus: 0.9, bike: 1.1, weather: 1.05 } },
    { ts: FROM + 2 * STEP, value: 50, layers: {} },
  ],
  ...over,
});
const ok = (x: unknown): boolean => PulseSchema.safeParse(x).success;

describe("PulseSchema", () => {
  it("acepta una serie válida (también vacía y con perfil aprendido)", () => {
    expect(ok(pulse())).toBe(true);
    expect(ok(pulse({ points: [] }))).toBe(true);
    expect(ok(pulse({ profile: "learned" }))).toBe(true);
  });
  it("round-trip JSON", () => {
    const m = PulseSchema.parse(pulse());
    expect(PulseSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  it("rechaza versión, perfil y claves desconocidas", () => {
    expect(ok(pulse({ v: 2 }))).toBe(false);
    expect(ok(pulse({ profile: "other" }))).toBe(false);
    expect(ok(pulse({ extra: 1 }))).toBe(false);
  });
  it("rechaza tiempos en segundos y ventanas inválidas", () => {
    expect(ok(pulse({ from: 1_760_000_100, to: 1_760_000_400 }))).toBe(false);
    expect(ok(pulse({ to: FROM }))).toBe(false);
    expect(ok(pulse({ to: FROM + PULSE_MAX_WINDOW_MS + STEP }))).toBe(false);
  });
  it("valida el paso", () => {
    expect(ok(pulse({ stepMs: 30_000 }))).toBe(false);
    expect(ok(pulse({ stepMs: 7_200_000 }))).toBe(false);
    expect(ok(pulse({ stepMs: 1.5 }))).toBe(false);
  });
  it("value: 0–100 con a lo sumo 1 decimal", () => {
    const v = (value: number): unknown => pulse({ points: [{ ts: FROM, value, layers: {} }] });
    expect(ok(v(0))).toBe(true);
    expect(ok(v(100))).toBe(true);
    expect(ok(v(-0.1))).toBe(false);
    expect(ok(v(100.1))).toBe(false);
    expect(ok(v(50.25))).toBe(false);
    expect(ok(v(Number.NaN))).toBe(false);
  });
  it("layers: capas conocidas, relativo 0..3", () => {
    const l = (layers: unknown): unknown => pulse({ points: [{ ts: FROM, value: 50, layers }] });
    expect(ok(l({ ship: 0, plane: 3 }))).toBe(true);
    expect(ok(l({ bus: -1 }))).toBe(false);
    expect(ok(l({ bus: 3.5 }))).toBe(false);
    expect(ok(l({ metro: 1 }))).toBe(false);
  });
  it("points: ts alineado al paso, dentro de la ventana y creciente", () => {
    const p = (ts: number[]): unknown =>
      pulse({ points: ts.map((t) => ({ ts: t, value: 50, layers: {} })) });
    expect(ok(p([FROM + 1]))).toBe(false); // no alineado
    expect(ok(p([FROM - STEP]))).toBe(false);
    expect(ok(p([FROM + 3 * STEP]))).toBe(false); // to es exclusivo
    expect(ok(p([FROM + STEP, FROM]))).toBe(false);
    expect(ok(p([FROM, FROM]))).toBe(false);
  });
});
