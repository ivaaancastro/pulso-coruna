import type { PulsePoint, PulseProfile } from "@pulso/schema";

/** Paso de la serie (5 min) y ventana (24 h): la ventana alineada al paso permite cachear en CDN. */
export const PULSE_STEP_MS = 300_000;
export const PULSE_WINDOW_MS = 24 * 3_600_000;
/** Un punto más viejo que esto (más un paso) se da por «sin datos recientes». */
export const PULSE_STALE_MS = 15 * 60_000;

export interface PulseWindow {
  from: number;
  to: number;
  stepMs: number;
}

/** Ventana de 24 h que termina al cierre del paso en curso; `from` queda alineado a `stepMs`. */
export function pulseWindow(nowMs: number, stepMs = PULSE_STEP_MS): PulseWindow {
  const to = (Math.floor(nowMs / stepMs) + 1) * stepMs;
  return { from: to - PULSE_WINDOW_MS, to, stepMs };
}

/** Datos ya validados de una respuesta de `/api/v1/pulse`. */
export interface PulseData extends PulseWindow {
  profile: PulseProfile;
  points: readonly PulsePoint[];
}

export type PulseFailure = "error" | "nodata";

export type PulseStatus = "loading" | "ready" | "stale" | "nodata" | "error";

export interface PulseSnapshot {
  status: PulseStatus;
  /** 0–100 con 1 decimal; `null` si no hay valor que mostrar. */
  value: number | null;
  profile: PulseProfile | null;
  /** Puntos hasta el instante `t` (en Reproducir, el futuro no se enseña). */
  points: readonly PulsePoint[];
  window: PulseWindow | null;
  t: number;
}

/** Cubre `t`, con un paso de gracia tras `to`: al cambiar de ventana se sigue viendo la serie anterior en vez de parpadear. */
const covers = (w: PulseWindow, t: number): boolean => t >= w.from && t < w.to + w.stepMs;

/**
 * Estado a mostrar para el instante `t` (reloj de la app: en Reproducir, el reproducido):
 * - sin datos que cubran `t`: cargando, o error/sin datos si la última petición falló;
 * - con datos: el valor es el último punto ≤ `t`; si es viejo (> 15 min) o no hay, se atenúa.
 */
export function deriveSnapshot(
  data: PulseData | null,
  failure: PulseFailure | null,
  t: number,
): PulseSnapshot {
  if (!data || !covers(data, t)) {
    return {
      status: failure ?? "loading",
      value: null,
      profile: null,
      points: [],
      window: null,
      t,
    };
  }
  const points = data.points.filter((p) => p.ts <= t);
  const window: PulseWindow = { from: data.from, to: data.to, stepMs: data.stepMs };
  const base = { profile: data.profile, points, window, t };
  const last = points[points.length - 1];
  if (!last) return { status: "nodata", value: null, ...base };
  const stale = t - last.ts > PULSE_STALE_MS + data.stepMs;
  return { status: stale ? "stale" : "ready", value: last.value, ...base };
}

export function seriesStats(
  points: readonly PulsePoint[],
): { min: number; max: number; last: number } | null {
  const last = points[points.length - 1];
  if (!last) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  return { min, max, last: last.value };
}
