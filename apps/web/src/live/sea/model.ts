import { SOURCE_THRESHOLDS } from "../source-status";
import type { TideSample } from "./history";

/**
 * Rango de referencia del nivel, m respecto al cero del puerto: bajamar y pleamar vivas orientativas
 * de A Coruña (las muestras de la nota van de 2,5 a 3,8 m). No es un dato oficial: se amplía con lo
 * visto en la sesión y se sustituirá por los niveles de la ficha del mareógrafo.
 */
export const REF_MIN = 0.4;
export const REF_MAX = 4.2;

/** Ruido de la pendiente por debajo del cual la marea se declara «estable», m/h. */
export const TREND_NOISE_M_PER_H = 0.1;
export const TREND_WINDOW_MS = 3_600_000;
export const TREND_MIN_SAMPLES = 3;
export const TREND_MIN_SPAN_MS = 10 * 60_000;
/** Pasado este tiempo sin lecturas la tendencia deja de conocerse. */
export const TREND_MAX_AGE_MS = SOURCE_THRESHOLDS.sea.delayedMs;

export type Trend = "rising" | "falling" | "steady";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Nivel respecto al rango reciente, 0 (bajo) … 1 (alto): referencia ampliada con los extremos de
 * la sesión, así nunca se sale de [0, 1].
 */
export function levelFraction(value: number, history: readonly TideSample[]): number {
  let lo = REF_MIN;
  let hi = REF_MAX;
  for (const s of history) {
    if (s.value < lo) lo = s.value;
    if (s.value > hi) hi = s.value;
  }
  if (value < lo) lo = value;
  if (value > hi) hi = value;
  return clamp01((value - lo) / (hi - lo));
}

/** Pendiente por mínimos cuadrados de las lecturas de la última hora, m/h; `null` si no basta. */
export function tideSlope(history: readonly TideSample[], now: number): number | null {
  const last = history[history.length - 1];
  if (!last || now - last.ts > TREND_MAX_AGE_MS) return null;
  const from = last.ts - TREND_WINDOW_MS;
  const win = history.filter((s) => s.ts >= from);
  const first = win[0];
  if (!first || win.length < TREND_MIN_SAMPLES || last.ts - first.ts < TREND_MIN_SPAN_MS) {
    return null;
  }
  const n = win.length;
  const hours = (s: TideSample): number => (s.ts - first.ts) / 3_600_000;
  const mx = win.reduce((a, s) => a + hours(s), 0) / n;
  const my = win.reduce((a, s) => a + s.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of win) {
    num += (hours(s) - mx) * (s.value - my);
    den += (hours(s) - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** «Sube», «baja» o «estable» solo por la tendencia; `null` si no se sabe (no se inventa la fase). */
export function tideTrend(history: readonly TideSample[], now: number): Trend | null {
  const slope = tideSlope(history, now);
  if (slope === null) return null;
  if (slope > TREND_NOISE_M_PER_H) return "rising";
  if (slope < -TREND_NOISE_M_PER_H) return "falling";
  return "steady";
}

export interface SeaView {
  /** Nivel actual, m. */
  value: number;
  /** UTC epoch ms de la lectura. */
  ts: number;
  /** 0..1 respecto al rango reciente. */
  fraction: number;
  trend: Trend | null;
}

/** Vista de la marea para dibujo, indicador y tarjeta; `null` sin lecturas. */
export function seaView(history: readonly TideSample[], now: number): SeaView | null {
  const last = history[history.length - 1];
  if (!last) return null;
  return {
    value: last.value,
    ts: last.ts,
    fraction: levelFraction(last.value, history),
    trend: tideTrend(history, now),
  };
}
