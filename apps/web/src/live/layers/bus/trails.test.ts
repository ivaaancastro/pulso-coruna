import { describe, expect, it } from "vitest";
import { TRAIL_PRESETS } from "./trail-config";
import { EMPTY_TRAILS, MAX_JUMP_M, TrailHistory } from "./trails";

const S = TRAIL_PRESETS.high; // 25 s, un vértice cada 300 ms y 2 m
const LON = -8.4;
const LAT = 43.37;
const M_LON = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180)); // grados de longitud por metro
const T0 = 1_760_000_000_000;
const white = () => [255, 255, 255] as const;

/** Un bus `id` a `m` metros al este del origen. */
const at = (...metres: number[]): Float32Array =>
  new Float32Array(metres.flatMap((m) => [LON + m * M_LON, LAT]));

describe("TrailHistory.record", () => {
  it("guarda un vértice por intervalo y solo si el bus se movió", () => {
    const h = new TrailHistory();
    h.record(T0, ["a"], at(0), 1, S);
    h.record(T0 + 100, ["a"], at(5), 1, S); // demasiado pronto
    expect(h.samples("a")).toBe(1);
    h.record(T0 + 300, ["a"], at(5), 1, S);
    expect(h.samples("a")).toBe(2);
    h.record(T0 + 600, ["a"], at(5.5), 1, S); // movió < 2 m: parado
    expect(h.samples("a")).toBe(2);
    h.record(T0 + 900, ["a"], at(9), 1, S);
    expect(h.samples("a")).toBe(3);
  });

  it("olvida lo que sale de la ventana y a los buses que desaparecen", () => {
    const h = new TrailHistory();
    for (let k = 0; k < 10; k++) h.record(T0 + k * 1000, ["a", "b"], at(k * 10, k * 10), 2, S);
    expect(h.size).toBe(2);
    // A los 30 s quedan los vértices de los últimos 25 s (t = 5…9 s) y el nuevo
    h.record(T0 + 30_000, ["a"], at(100), 1, S);
    expect(h.size).toBe(1);
    expect(h.samples("a")).toBe(6);
    // Mucho después, solo el nuevo
    h.record(T0 + 90_000, ["a"], at(200), 1, S);
    expect(h.samples("a")).toBe(1);
  });

  it("un salto largo (el worker «salta» tras un hueco) corta la estela", () => {
    const h = new TrailHistory();
    h.record(T0, ["a"], at(0), 1, S);
    h.record(T0 + 1000, ["a"], at(10), 1, S);
    expect(h.samples("a")).toBe(2);
    h.record(T0 + 2000, ["a"], at(10 + MAX_JUMP_M * 2), 1, S);
    expect(h.samples("a")).toBe(1);
  });

  it("si el reloj retrocede mucho (otra hora) descarta el histórico", () => {
    const h = new TrailHistory();
    h.record(T0, ["a"], at(0), 1, S);
    h.record(T0 + 1000, ["a"], at(10), 1, S);
    h.record(T0 - 3_600_000, ["a"], at(0), 1, S);
    expect(h.samples("a")).toBe(1);
  });
});

describe("TrailHistory.build", () => {
  it("construye buffers binarios: vértices guardados + cabeza en la posición actual, tiempos relativos a now", () => {
    const h = new TrailHistory();
    h.record(T0, ["a", "b"], at(0, 0), 2, S);
    h.record(T0 + 1000, ["a", "b"], at(10, 20), 2, S);
    const now = T0 + 2000;
    const out = h.build(now, ["a", "b"], at(30, 40), 2, S.lengthMs, (i) =>
      i === 0 ? [1, 2, 3] : [4, 5, 6],
    );
    expect(out.length).toBe(2);
    expect(Array.from(out.startIndices)).toEqual([0, 3, 6]);
    expect(out.vertexCount).toBe(6);
    expect(Array.from(out.timestamps)).toEqual([-2000, -1000, 0, -2000, -1000, 0]);
    // cabeza de «a» = 30 m
    expect(out.positions[2 * 2]).toBeCloseTo(LON + 30 * M_LON, 6);
    expect(Array.from(out.colors.slice(0, 4))).toEqual([1, 2, 3, 255]);
    expect(Array.from(out.colors.slice(12, 16))).toEqual([4, 5, 6, 255]);
  });

  it("recorta a la longitud pedida: una estela más corta deja fuera los vértices viejos", () => {
    const h = new TrailHistory();
    for (let k = 0; k < 10; k++) h.record(T0 + k * 1000, ["a"], at(k * 10), 1, S);
    const now = T0 + 10_000;
    const long = h.build(now, ["a"], at(100), 1, 25_000, white);
    const short = h.build(now, ["a"], at(100), 1, 3500, white);
    expect(long.vertexCount).toBe(11);
    expect(short.vertexCount).toBe(4); // t = 7, 8, 9 s + cabeza
    expect(Math.min(...short.timestamps)).toBeGreaterThanOrEqual(-3500);
  });

  it("longitud 0, histórico vacío o ids que no coinciden: sin estelas", () => {
    const h = new TrailHistory();
    expect(h.build(T0, ["a"], at(0), 1, 5000, white)).toBe(EMPTY_TRAILS);
    h.record(T0, ["a"], at(0), 1, S);
    expect(h.build(T0, ["a"], at(0), 1, 0, white)).toBe(EMPTY_TRAILS);
    expect(h.build(T0, ["zzz"], at(0), 1, 5000, white)).toBe(EMPTY_TRAILS);
  });

  it("los timestamps caben en float32 sin perder precisión", () => {
    const h = new TrailHistory();
    h.record(T0, ["a"], at(0), 1, S);
    h.record(T0 + 1000, ["a"], at(10), 1, S);
    const out = h.build(T0 + 1300, ["a"], at(14), 1, S.lengthMs, white);
    for (const t of out.timestamps) expect(Math.fround(t)).toBe(t);
  });
});
