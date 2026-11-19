import type { Rgb } from "./line-color";
import type { TrailSettings } from "./trail-config";

/**
 * Histórico reciente de posiciones por bus y construcción de las estelas (`TripsLayer`). Se
 * alimenta de los fotogramas interpolados que ya entrega el worker: no pide nada a la red. Sin
 * dependencias de deck.gl ni del DOM.
 */

const M_PER_DEG = 111_320;
/** Salto entre vértices consecutivos a partir del cual se corta la estela (el worker «salta» tras un hueco largo). */
export const MAX_JUMP_M = 150;
/** Si el reloj retrocede más que esto (reproducir, cambio de hora), se descarta el histórico. */
const MAX_BACKWARD_MS = 1000;
const COMPACT_AT = 64;

function meters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)) * M_PER_DEG;
  const dy = (lat2 - lat1) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

interface Entry {
  /** Instantes (reloj de la app, ms), lon y lat de los vértices guardados; válidos desde `start`. */
  t: number[];
  x: number[];
  y: number[];
  start: number;
  seen: number;
}

/** Buffers binarios listos para `TripsLayer` (`data.attributes` + `startIndices`). */
export interface TrailBuffers {
  /** Número de estelas (autobuses con al menos 2 vértices). */
  length: number;
  /** Inicio de cada estela en vértices; `length + 1` entradas. */
  startIndices: Uint32Array;
  /** lon, lat intercalados. Float64: la posición no pierde precisión a zoom alto. */
  positions: Float64Array;
  /** Instante de cada vértice relativo a `now` (≤ 0, ms): en float32 no cabe el epoch. */
  timestamps: Float32Array;
  /** RGBA por vértice (deck.gl exige un color por vértice con datos binarios). */
  colors: Uint8Array;
  vertexCount: number;
}

export const EMPTY_TRAILS: TrailBuffers = {
  length: 0,
  startIndices: new Uint32Array([0]),
  positions: new Float64Array(0),
  timestamps: new Float32Array(0),
  colors: new Uint8Array(0),
  vertexCount: 0,
};

export class TrailHistory {
  private readonly entries = new Map<string, Entry>();
  private epoch = 0;
  private lastNow = Number.NEGATIVE_INFINITY;

  /** Autobuses con histórico. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.lastNow = Number.NEGATIVE_INFINITY;
  }

  /** Vértices guardados de un bus (para tests y diagnóstico). */
  samples(id: string): number {
    const e = this.entries.get(id);
    return e ? e.t.length - e.start : 0;
  }

  /**
   * Anota el fotograma de `now`. `positions` = lon, lat intercalados en el orden de `ids`. Solo
   * guarda un vértice si pasó `sampleMs` y el bus se movió `minStepM`; un salto de más de
   * `MAX_JUMP_M` reinicia su estela; los buses que ya no están se olvidan.
   */
  record(
    now: number,
    ids: readonly string[],
    positions: ArrayLike<number>,
    count: number,
    settings: TrailSettings,
  ): void {
    if (now < this.lastNow - MAX_BACKWARD_MS) this.entries.clear();
    this.lastNow = now;
    const epoch = ++this.epoch;
    const cutoff = now - settings.lengthMs;
    const n = Math.min(count, ids.length);
    for (let i = 0; i < n; i++) {
      const id = ids[i] as string;
      const lon = positions[2 * i] as number;
      const lat = positions[2 * i + 1] as number;
      let e = this.entries.get(id);
      if (!e) {
        e = { t: [now], x: [lon], y: [lat], start: 0, seen: epoch };
        this.entries.set(id, e);
        continue;
      }
      e.seen = epoch;
      const last = e.t.length - 1;
      if (last < e.start) {
        e.t.push(now);
        e.x.push(lon);
        e.y.push(lat);
      } else {
        const d = meters(e.x[last] as number, e.y[last] as number, lon, lat);
        if (d > MAX_JUMP_M) {
          e.t = [now];
          e.x = [lon];
          e.y = [lat];
          e.start = 0;
        } else if (now - (e.t[last] as number) >= settings.sampleMs && d >= settings.minStepM) {
          e.t.push(now);
          e.x.push(lon);
          e.y.push(lat);
        }
      }
      // Olvida lo que ya salió de la ventana.
      while (e.start < e.t.length && (e.t[e.start] as number) < cutoff) e.start++;
      if (e.start >= COMPACT_AT) {
        e.t = e.t.slice(e.start);
        e.x = e.x.slice(e.start);
        e.y = e.y.slice(e.start);
        e.start = 0;
      }
    }
    if (this.entries.size > n) {
      for (const [id, e] of this.entries) if (e.seen !== epoch) this.entries.delete(id);
    }
  }

  /**
   * Construye las estelas de `now`: los vértices guardados dentro de la ventana más la posición
   * actual como cabeza (t = 0). Los buses sin al menos un vértice previo no dibujan estela.
   */
  build(
    now: number,
    ids: readonly string[],
    positions: ArrayLike<number>,
    count: number,
    lengthMs: number,
    colorOf: (index: number) => Rgb,
  ): TrailBuffers {
    if (lengthMs <= 0) return EMPTY_TRAILS;
    const cutoff = now - lengthMs;
    const n = Math.min(count, ids.length);
    const firstValid = (e: Entry): number => {
      let s = e.start;
      while (s < e.t.length && (e.t[s] as number) < cutoff) s++;
      return s;
    };

    let vertices = 0;
    let paths = 0;
    for (let i = 0; i < n; i++) {
      const e = this.entries.get(ids[i] as string);
      if (!e) continue;
      const kept = e.t.length - firstValid(e);
      if (kept >= 2) {
        vertices += kept + 1;
        paths++;
      }
    }
    if (paths === 0) return EMPTY_TRAILS;

    const startIndices = new Uint32Array(paths + 1);
    const out = new Float64Array(vertices * 2);
    const times = new Float32Array(vertices);
    const colors = new Uint8Array(vertices * 4);
    // Un color por vértice escrito de una vez (RGBA little-endian, el orden de todos los navegadores).
    const colors32 = new Uint32Array(colors.buffer);
    let v = 0;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const e = this.entries.get(ids[i] as string);
      if (!e) continue;
      const s = firstValid(e);
      if (e.t.length - s < 2) continue;
      const [r, g, b] = colorOf(i);
      const rgba = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      startIndices[p++] = v;
      for (let k = s; k < e.t.length; k++) {
        out[2 * v] = e.x[k] as number;
        out[2 * v + 1] = e.y[k] as number;
        times[v] = (e.t[k] as number) - now;
        colors32[v++] = rgba;
      }
      out[2 * v] = positions[2 * i] as number;
      out[2 * v + 1] = positions[2 * i + 1] as number;
      times[v] = 0;
      colors32[v++] = rgba;
    }
    startIndices[paths] = v;
    return {
      length: paths,
      startIndices,
      positions: out,
      timestamps: times,
      colors,
      vertexCount: v,
    };
  }
}
