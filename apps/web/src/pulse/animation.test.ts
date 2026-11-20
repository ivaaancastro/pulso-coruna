import { describe, expect, it } from "vitest";
import { COUNT_DURATION_MS, countValue, createNumberAnimator, easeOutCubic } from "./animation";

describe("easing", () => {
  it("empieza en 0, acaba en 1 y es monótono (sin rebote)", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });

  it("countValue interpola y llega exactamente al destino", () => {
    expect(countValue(0, 60, 0, 700)).toBe(0);
    const mid = countValue(0, 60, 350, 700);
    expect(mid).toBeGreaterThan(30); // salida suave: más de la mitad a mitad de tiempo
    expect(mid).toBeLessThan(60);
    expect(countValue(0, 60, 700, 700)).toBe(60);
    expect(countValue(10, 5, 9999, 700)).toBe(5);
    expect(countValue(0, 60, 100, 0)).toBe(60);
  });
});

function setup(reduced: boolean) {
  let clock = 0;
  const frames: (() => void)[] = [];
  const painted: number[] = [];
  const animator = createNumberAnimator({
    paint: (n) => painted.push(n),
    reducedMotion: () => reduced,
    perf: () => clock,
    raf: (cb) => {
      frames.push(cb);
      return () => frames.splice(frames.indexOf(cb), 1);
    },
  });
  const advance = (ms: number): void => {
    clock += ms;
    const run = frames.splice(0);
    run.forEach((cb) => cb());
  };
  return { animator, painted, advance, frames };
}

describe("contador", () => {
  it("cuenta con easing desde 0, sin repetir valores (sin parpadeo) y termina exacto", () => {
    const { animator, painted, advance, frames } = setup(false);
    animator.to(62);
    for (let i = 0; i < 60 && frames.length; i++) advance(16);
    expect(painted[painted.length - 1]).toBe(62);
    expect(animator.shown).toBe(62);
    expect(new Set(painted).size).toBe(painted.length);
    expect(painted).toEqual([...painted].sort((a, b) => a - b));
    expect(painted.length).toBeGreaterThan(3);
    expect(frames).toHaveLength(0);
    expect(16 * 60).toBeGreaterThan(COUNT_DURATION_MS);
  });

  it("un cambio nuevo parte del valor mostrado, no de cero", () => {
    const { animator, painted, advance, frames } = setup(false);
    animator.to(40);
    for (let i = 0; i < 60 && frames.length; i++) advance(16);
    painted.length = 0;
    animator.to(45);
    for (let i = 0; i < 60 && frames.length; i++) advance(16);
    expect(painted.every((n) => n >= 40 && n <= 45)).toBe(true);
    expect(animator.shown).toBe(45);
  });

  it("prefers-reduced-motion: cambio directo, sin fotogramas", () => {
    const { animator, painted, frames } = setup(true);
    animator.to(73);
    expect(painted).toEqual([73]);
    expect(frames).toHaveLength(0);
    animator.to(20);
    expect(painted).toEqual([73, 20]);
    expect(frames).toHaveLength(0);
  });

  it("el mismo destino no reanima y reset vuelve a empezar", () => {
    const { animator, painted, frames } = setup(true);
    animator.to(50);
    animator.to(50);
    expect(painted).toEqual([50]);
    animator.reset();
    expect(animator.shown).toBeNull();
    animator.to(50);
    expect(painted).toEqual([50, 50]);
    expect(frames).toHaveLength(0);
  });

  it("destroy cancela la animación en curso", () => {
    const { animator, frames } = setup(false);
    animator.to(90);
    expect(frames).toHaveLength(1);
    animator.destroy();
    expect(frames).toHaveLength(0);
  });
});
