import { COVERAGE, M_LAT, type FieldValue, type WindField } from "./field";
import { clampQuality, type SegmentBuffers } from "./particles";

/**
 * Modo `prefers-reduced-motion`: trazos fijos con punta de flecha en una rejilla regular. Sin
 * animación; se recalculan solo cuando cambian los datos o la calidad.
 */

/** Paso de rejilla con calidad 1, m. Con menos calidad, la rejilla se aclara (paso / √q). */
export const GRID_STEP_M = 1100;
/** Por debajo de esta confianza o velocidad (m/s) no se dibuja flecha. */
const MIN_CONFIDENCE = 0.15;
const MIN_SPEED = 0.3;
/** Velocidad (m/s) a la que la flecha ocupa casi todo el paso de rejilla. */
const FULL_LENGTH_SPEED = 12;
const BARB_ANGLE = (25 * Math.PI) / 180;
const SEGMENTS_PER_ARROW = 3;

export interface Arrows extends SegmentBuffers {
  count: number;
}

export function gridStep(quality: number): number {
  return GRID_STEP_M / Math.sqrt(clampQuality(quality));
}

export function buildArrows(
  field: WindField,
  quality: number,
  rgb: readonly [number, number, number],
  alpha: number,
): Arrows {
  const step = gridStep(quality);
  const dLat = step / M_LAT;
  const rows = Math.max(1, Math.floor((COVERAGE.north - COVERAGE.south) / dLat));
  const midLat = (COVERAGE.north + COVERAGE.south) / 2;
  const dLonMid = step / (Math.cos((midLat * Math.PI) / 180) * M_LAT);
  const cols = Math.max(1, Math.floor((COVERAGE.east - COVERAGE.west) / dLonMid));
  const cap = rows * cols * SEGMENTS_PER_ARROW;
  const out: Arrows = {
    source: new Float32Array(cap * 2),
    target: new Float32Array(cap * 2),
    color: new Uint8Array(cap * 4),
    count: 0,
  };
  if (field.empty) return out;

  const v: FieldValue = { u: 0, v: 0, confidence: 0 };
  const push = (x0: number, y0: number, x1: number, y1: number, a: number): void => {
    const o = out.count * 2;
    out.source[o] = x0;
    out.source[o + 1] = y0;
    out.target[o] = x1;
    out.target[o + 1] = y1;
    const c = out.count * 4;
    out.color[c] = rgb[0];
    out.color[c + 1] = rgb[1];
    out.color[c + 2] = rgb[2];
    out.color[c + 3] = Math.round(a * 255);
    out.count++;
  };

  for (let r = 0; r < rows; r++) {
    const lat = COVERAGE.south + (r + 0.5) * dLat;
    const kx = Math.cos((lat * Math.PI) / 180) * M_LAT;
    for (let c = 0; c < cols; c++) {
      const lon = COVERAGE.west + (c + 0.5) * dLonMid;
      field.sample(lon, lat, v);
      const speed = Math.hypot(v.u, v.v);
      if (v.confidence < MIN_CONFIDENCE || speed < MIN_SPEED) continue;
      // Metros: este (x) y norte (y). Longitud proporcional a la velocidad, con tope bajo el paso.
      const len = step * 0.75 * Math.min(1, Math.max(0.2, speed / FULL_LENGTH_SPEED));
      const ex = v.u / speed;
      const ny = v.v / speed;
      const hx = (ex * len) / 2;
      const hy = (ny * len) / 2;
      const a = alpha * v.confidence;
      const toLon = (m: number): number => lon + m / kx;
      const toLat = (m: number): number => lat + m / M_LAT;
      push(toLon(-hx), toLat(-hy), toLon(hx), toLat(hy), a);
      // Punta: dos trazos hacia atrás desde la cabeza, ±25° respecto al eje.
      const barb = len * 0.3;
      for (const sgn of [-1, 1]) {
        const cos = Math.cos(BARB_ANGLE * sgn);
        const sin = Math.sin(BARB_ANGLE * sgn);
        // Gira ±25° el vector unitario «hacia atrás» (−ex, −ny).
        const rx = -ex * cos + ny * sin;
        const ry = -ex * sin - ny * cos;
        push(toLon(hx), toLat(hy), toLon(hx + rx * barb), toLat(hy + ry * barb), a);
      }
    }
  }
  return out;
}
