/** Tempo y rejilla: corcheas a 90 bpm. */
export const BPM = 90;
export const STEP_SEC = 60 / BPM / 2;

/** Primer paso de la rejilla (origen + k·paso) que no queda antes de `timeSec`. */
export function quantizeToStep(timeSec: number, originSec: number, stepSec = STEP_SEC): number {
  const k = Math.ceil((timeSec - originSec) / stepSec - 1e-9);
  return originSec + Math.max(0, k) * stepSec;
}

/** Índice del primer paso que no queda antes de `timeSec`. */
export function stepIndexAt(timeSec: number, originSec: number, stepSec = STEP_SEC): number {
  return Math.max(0, Math.ceil((timeSec - originSec) / stepSec - 1e-9));
}

export function stepTime(index: number, originSec: number, stepSec = STEP_SEC): number {
  return originSec + index * stepSec;
}

/** RNG determinista (mulberry32): mismo estado → misma música, y tests estables. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
