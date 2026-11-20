import type { AudioEngine } from "./engine";
import { stepIndexAt, stepTime } from "./grid";
import { planStep } from "./score";
import type { SoundState } from "./state";

/** Cada cuánto se despierta el planificador y cuánto por delante programa (s). */
export const TICK_MS = 25;
export const LOOKAHEAD_SEC = 0.12;

export interface ConductorOptions {
  engine: AudioEngine;
  /** Estado de las capas (se lee una vez por despertar, no por paso). */
  readState: () => SoundState;
  rng: () => number;
  /** `false`: solo capas continuas (Reproducir en pausa). */
  transientsEnabled?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Conductor {
  start(): void;
  stop(): void;
  /** Un despertar del planificador (público para los tests). */
  tick(): void;
}

/**
 * Planificador con anticipación sobre `ctx.currentTime`: cada paso de la rejilla pide sus eventos
 * a la partitura pura y los programa en su instante exacto. Si el contexto estuvo suspendido, el
 * tiempo no avanza y no se acumulan pasos atrasados.
 */
export function createConductor(opts: ConductorOptions): Conductor {
  const { engine } = opts;
  const setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let handle: unknown = null;
  let origin = 0;
  let next = 0;

  const tick = (): void => {
    if (engine.ctx.state === "suspended" || engine.ctx.state === "closed") return;
    const now = engine.ctx.currentTime;
    // Si nos quedamos atrás (hilo bloqueado), salta al siguiente paso de la rejilla.
    next = Math.max(next, stepIndexAt(now, origin));
    const horizon = now + LOOKAHEAD_SEC;
    if (stepTime(next, origin) > horizon) return;
    const state = opts.readState();
    engine.setContinuous(state);
    const transients = opts.transientsEnabled ? opts.transientsEnabled() : true;
    while (stepTime(next, origin) <= horizon) {
      const when = stepTime(next, origin);
      for (const e of planStep(state, next, opts.rng, { transients })) engine.play(e, when);
      next++;
    }
  };

  return {
    tick,
    start() {
      if (handle !== null) return;
      origin = engine.ctx.currentTime;
      next = 0;
      tick();
      handle = setTimer(tick, TICK_MS);
    },
    stop() {
      if (handle === null) return;
      clearTimer(handle);
      handle = null;
    },
  };
}
