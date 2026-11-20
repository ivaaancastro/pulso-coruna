import type { PulsePoint } from "@pulso/schema";

export const SERIES_W = 200;
export const SERIES_H = 40;
const PAD = 3;

export interface SeriesGeometry {
  /** Trazo de la serie (tramos separados con `M` donde faltan puntos). */
  line: string;
  /** Relleno bajo cada tramo de ≥ 2 puntos. */
  area: string;
  /** Marca del último punto (el «ahora»). */
  last: { x: number; y: number } | null;
  /** Altura de la referencia 50 = «lo habitual». */
  midY: number;
}

interface XY {
  x: number;
  y: number;
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

export const yFor = (value: number, h = SERIES_H): number =>
  PAD + (1 - Math.min(100, Math.max(0, value)) / 100) * (h - 2 * PAD);

/**
 * Serie → path SVG. Eje x = ventana `[from, to)`; eje y fijo 0–100 (así 50 está siempre a media
 * altura). Un hueco de ≥ 1 punto (ts − anterior > 2·paso) corta el trazo: no se inventan datos.
 */
export function buildSeries(
  points: readonly PulsePoint[],
  from: number,
  to: number,
  stepMs: number,
  w = SERIES_W,
  h = SERIES_H,
): SeriesGeometry {
  const span = Math.max(1, to - from);
  const x = (ts: number): number => PAD + ((ts - from) / span) * (w - 2 * PAD);
  const segments: XY[][] = [];
  let prev = -Infinity;
  for (const p of points) {
    if (p.ts - prev > 2 * stepMs) segments.push([]);
    prev = p.ts;
    segments[segments.length - 1]?.push({ x: x(p.ts), y: yFor(p.value, h) });
  }
  let line = "";
  let area = "";
  for (const seg of segments) {
    const [first, ...rest] = seg;
    const end = seg[seg.length - 1];
    if (!first || !end) continue;
    // Un punto aislado se dibuja como una marca (con linecap redondo).
    line += `M${f(first.x)} ${f(first.y)}${rest.length === 0 ? "h0.01" : ""}`;
    for (const p of rest) line += `L${f(p.x)} ${f(p.y)}`;
    if (rest.length > 0) {
      area += `M${f(first.x)} ${f(h - PAD)}`;
      for (const p of seg) area += `L${f(p.x)} ${f(p.y)}`;
      area += `L${f(end.x)} ${f(h - PAD)}Z`;
    }
  }
  const lastSeg = segments[segments.length - 1];
  return { line, area, last: lastSeg?.[lastSeg.length - 1] ?? null, midY: yFor(50, h) };
}
