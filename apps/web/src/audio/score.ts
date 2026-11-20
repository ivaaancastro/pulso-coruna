import { degreeToHz } from "./scale";
import type { SoundState } from "./state";

/** Capas que suenan (las que no, como el tren, no tienen timbre). */
export type SoundLayer = "bus" | "bike" | "sea" | "wind" | "air" | "ship" | "plane";
export type EventKind = "note" | "kick" | "hat" | "bell" | "horn" | "sweep";

/** Evento musical puro: qué suena y en qué paso de la rejilla, sin tocar el audio. */
export interface MusicEvent {
  layer: SoundLayer;
  kind: EventKind;
  /** Índice absoluto del paso de la rejilla. */
  step: number;
  /** Frecuencia en Hz (siempre una nota de la pentatónica; el ruido la ignora). */
  freq: number;
  /** Pico de ganancia 0–1 antes del nivel de la capa. */
  gain: number;
  /** Duración en segundos. */
  dur: number;
  /** Mayor = más difícil de robar. */
  priority: number;
}

export interface PlanOptions {
  /** `false` (p. ej. Reproducir en pausa): solo suenan las capas continuas, nada de eventos. */
  transients?: boolean;
}

export const PRIORITY: Record<SoundLayer, number> = {
  sea: 100,
  wind: 100,
  ship: 6,
  plane: 5,
  air: 5,
  bike: 4,
  bus: 2,
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function event(
  layer: SoundLayer,
  kind: EventKind,
  step: number,
  degree: number,
  gain: number,
  dur: number,
): MusicEvent {
  return { layer, kind, step, freq: degreeToHz(degree), gain, dur, priority: PRIORITY[layer] };
}

/**
 * Función pura: estado de capas + paso de rejilla → eventos de ese paso. `rng` es la única fuente
 * de azar (determinista en tests). La densidad crece con la actividad de cada capa.
 */
export function planStep(
  state: SoundState,
  step: number,
  rng: () => number,
  opts: PlanOptions = {},
): MusicEvent[] {
  if (opts.transients === false) return [];
  const out: MusicEvent[] = [];

  // Autobuses: notas cortas agudas (grados 10–14: dos octavas sobre La3).
  if (state.bus.count > 0) {
    const p = 0.1 + 0.5 * clamp01(state.bus.count / 30);
    if (rng() < p) {
      out.push(event("bus", "note", step, 10 + Math.floor(rng() * 5), 0.1, 0.16));
    }
  }

  // BiciCoruña: pulso suave; cuantas menos bicis quedan en las estaciones, más «hats».
  if (state.bike.stations > 0) {
    if (step % 4 === 0) out.push(event("bike", "kick", step, -10, 0.2, 0.22));
    const hatP = step % 4 === 2 ? 0.55 : 0.1 + 0.3 * (1 - clamp01(state.bike.availability));
    if (rng() < hatP) out.push(event("bike", "hat", step, 0, 0.05, 0.05));
  }

  // Acentos escasos: barcos (nota grave larga), aviones (barrido agudo), aire (campana).
  if (state.ship.count > 0 && step % 16 === 0 && rng() < Math.min(0.4, 0.08 * state.ship.count)) {
    out.push(event("ship", "horn", step, -5, 0.09, 1.4));
  }
  if (state.plane.count > 0 && step % 8 === 3 && rng() < Math.min(0.3, 0.06 * state.plane.count)) {
    out.push(event("plane", "sweep", step, 14, 0.035, 1.1));
  }
  if (state.air.level > 0 && step % 8 === 6 && rng() < 0.05 + 0.04 * state.air.level) {
    out.push(event("air", "bell", step, 12 - state.air.level, 0.07, 1.2));
  }
  return out;
}
