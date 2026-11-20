/** Contador del número grande: easing suave de salida (sin rebote ni parpadeo). */
export const COUNT_DURATION_MS = 700;

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** Valor mostrado `elapsed` ms después de empezar a ir de `from` a `to`. */
export function countValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * easeOutCubic(elapsed / duration);
}

export interface NumberAnimatorOptions {
  /** Pinta el entero actual. */
  paint: (n: number) => void;
  reducedMotion: () => boolean;
  perf?: () => number;
  /** rAF inyectable; devuelve cómo cancelar. */
  raf?: (cb: () => void) => () => void;
  duration?: number;
}

export interface NumberAnimator {
  /** Lleva el número a `to` (con easing, o directo con prefers-reduced-motion). */
  to(target: number): void;
  /** Olvida el valor (el siguiente `to` vuelve a contar desde 0). */
  reset(): void;
  /** Entero mostrado ahora (`null` si aún no se ha pintado). */
  readonly shown: number | null;
  destroy(): void;
}

const defaultRaf = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

export function createNumberAnimator(opts: NumberAnimatorOptions): NumberAnimator {
  const perf = opts.perf ?? (() => performance.now());
  const raf = opts.raf ?? defaultRaf;
  const duration = opts.duration ?? COUNT_DURATION_MS;
  let target: number | null = null;
  let shown: number | null = null;
  let cancel: (() => void) | null = null;

  const paint = (n: number): void => {
    const rounded = Math.round(n);
    if (rounded === shown) return;
    shown = rounded;
    opts.paint(rounded);
  };

  return {
    to(next) {
      if (target === next) return;
      cancel?.();
      cancel = null;
      const from = shown ?? 0;
      target = next;
      if (opts.reducedMotion() || duration <= 0 || Math.round(next) === from) {
        paint(next);
        return;
      }
      const start = perf();
      const step = (): void => {
        const elapsed = perf() - start;
        paint(countValue(from, next, elapsed, duration));
        cancel = elapsed >= duration ? null : raf(step);
      };
      step();
    },
    reset() {
      cancel?.();
      cancel = null;
      target = null;
      shown = null;
    },
    get shown() {
      return shown;
    },
    destroy() {
      cancel?.();
      cancel = null;
    },
  };
}
