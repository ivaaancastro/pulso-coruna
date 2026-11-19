import type { LayerItem } from "@pulso/schema";
import { WIND_STATIONS, type WindStation } from "./stations";

/** Zona de A Coruña donde se dibuja el viento (fuera, nada). */
export const COVERAGE = { west: -8.5, east: -8.34, south: 43.32, north: 43.42 } as const;

/** Un dato de la fuente con más de esto se considera caído: no se dibuja (la fuente da uno cada 10 min). */
export const MAX_SAMPLE_AGE_MS = 60 * 60 * 1000;

/** Confianza 1 hasta `FULL_CONFIDENCE_M` de la estación más cercana y 0 a `NO_CONFIDENCE_M`. */
export const FULL_CONFIDENCE_M = 4_000;
export const NO_CONFIDENCE_M = 14_000;

export const M_LAT = 111_320;
const DEG = Math.PI / 180;

/** Vector de viento en m/s: `u` hacia el este, `v` hacia el norte (hacia dónde va el aire). */
export interface WindVector {
  u: number;
  v: number;
}

export interface WindSample extends WindVector {
  stationId: string;
  lon: number;
  lat: number;
}

export interface FieldValue extends WindVector {
  /** 0..1: cuánto respalda este punto una estación cercana. */
  confidence: number;
}

/**
 * `wind_dir` es meteorológica: grados desde el norte, en sentido horario, **de dónde sopla**.
 * Viento del norte (0°) lleva el aire hacia el sur; del oeste (270°), hacia el este.
 */
export function windToVector(speed: number, dirFromDeg: number): WindVector {
  const a = dirFromDeg * DEG;
  // `+ 0` evita el -0 de sin(0) y cos(90°).
  return { u: -speed * Math.sin(a) + 0, v: -speed * Math.cos(a) + 0 };
}

/** Rumbo (grados, 0 = norte) hacia el que se mueve el aire. */
export function vectorHeading(w: WindVector): number {
  return (((Math.atan2(w.u, w.v) / DEG) % 360) + 360) % 360;
}

const UNIT_TO_MS: Record<string, number> = {
  "m/s": 1,
  "km/h": 1 / 3.6,
  kt: 0.514444,
  kn: 0.514444,
};

/** Velocidad en m/s, o `null` si la unidad no se conoce. */
export function toMetresPerSecond(value: number, unit: string): number | null {
  const f = UNIT_TO_MS[unit.trim().toLowerCase()];
  return f === undefined ? null : value * f;
}

export function inCoverage(lon: number, lat: number): boolean {
  return (
    lon >= COVERAGE.west && lon <= COVERAGE.east && lat >= COVERAGE.south && lat <= COVERAGE.north
  );
}

/**
 * Muestras de viento válidas a partir de las observaciones `weather`: estación conocida, velocidad
 * y dirección frescas, finitas y en rango. Lo demás se descarta.
 */
export function buildSamples(
  items: Iterable<LayerItem>,
  now: number,
  stations: Readonly<Record<string, WindStation>> = WIND_STATIONS,
  maxAgeMs: number = MAX_SAMPLE_AGE_MS,
): WindSample[] {
  const speeds = new Map<string, number>();
  const dirs = new Map<string, number>();
  for (const item of items) {
    if (!("stationId" in item) || item.layer !== "weather") continue;
    if (now - item.ts > maxAgeMs || !Number.isFinite(item.value)) continue;
    if (item.metric === "wind_speed") {
      const ms = toMetresPerSecond(item.value, item.unit);
      if (ms !== null && ms >= 0 && ms <= 100) speeds.set(item.stationId, ms);
    } else if (item.metric === "wind_dir") {
      if (item.value >= 0 && item.value <= 360) dirs.set(item.stationId, item.value);
    }
  }
  const out: WindSample[] = [];
  for (const [stationId, speed] of speeds) {
    const dir = dirs.get(stationId);
    const st = stations[stationId];
    if (dir === undefined || !st) continue;
    out.push({ stationId, lon: st.lon, lat: st.lat, ...windToVector(speed, dir) });
  }
  return out;
}

export interface WindField {
  /** Sin muestras: no hay nada que dibujar. */
  readonly empty: boolean;
  readonly samples: readonly WindSample[];
  /** Viento y confianza en un punto. `out` evita asignaciones en el bucle caliente. */
  sample(lon: number, lat: number, out?: FieldValue): FieldValue;
}

/**
 * Campo por IDW (potencia 2) de las componentes `(u, v)`; no de módulo y ángulo por separado, para
 * no promediar ángulos. Sobre una estación vale exactamente su dato; con una sola, el campo es
 * uniforme. Es una media ponderada: nunca supera la mayor velocidad medida ni crea remolinos o
 * divergencia que las estaciones no muestran. La confianza cae con la distancia a la más cercana.
 */
export function createWindField(samples: readonly WindSample[]): WindField {
  const n = samples.length;
  const lon = Float64Array.from(samples, (s) => s.lon);
  const lat = Float64Array.from(samples, (s) => s.lat);
  const u = Float64Array.from(samples, (s) => s.u);
  const v = Float64Array.from(samples, (s) => s.v);
  return {
    empty: n === 0,
    samples,
    sample(x, y, out = { u: 0, v: 0, confidence: 0 }) {
      if (n === 0) {
        out.u = 0;
        out.v = 0;
        out.confidence = 0;
        return out;
      }
      const kx = Math.cos(y * DEG) * M_LAT;
      let wSum = 0;
      let uSum = 0;
      let vSum = 0;
      let dMin2 = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = (x - (lon[i] as number)) * kx;
        const dy = (y - (lat[i] as number)) * M_LAT;
        const d2 = dx * dx + dy * dy;
        if (d2 < dMin2) dMin2 = d2;
        if (d2 < 1) {
          // Sobre la estación (< 1 m): su dato exacto.
          out.u = u[i] as number;
          out.v = v[i] as number;
          out.confidence = 1;
          return out;
        }
        const w = 1 / d2;
        wSum += w;
        uSum += w * (u[i] as number);
        vSum += w * (v[i] as number);
      }
      out.u = uSum / wSum;
      out.v = vSum / wSum;
      const c = (NO_CONFIDENCE_M - Math.sqrt(dMin2)) / (NO_CONFIDENCE_M - FULL_CONFIDENCE_M);
      out.confidence = Math.min(1, Math.max(0, c));
      return out;
    },
  };
}
