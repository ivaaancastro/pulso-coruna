import { fromReplayCoord, fromReplaySpeed, type LayerId, type ReplayWindow } from "@pulso/schema";
import { bearingAndDistance, lerpHeading, normalizeHeading } from "../live/interpolation";

/**
 * Series temporales de un instante de reproducción: se construyen a partir de la ventana que
 * contiene `t` (con su estado inicial `init`) y de la siguiente (para interpolar tras la última
 * muestra). Tras construirlas, preguntar «¿dónde está X en `t`?» es una búsqueda binaria: sirve
 * igual hacia delante que hacia atrás o a saltos (arrastre).
 */

export type Meta = Record<string, string | number>;

export interface MobileSeries {
  id: string;
  meta: Meta | undefined;
  /** Instantes absolutos (epoch ms UTC), estrictamente crecientes. */
  t: Float64Array;
  lon: Float64Array;
  lat: Float64Array;
  /** Grados; `NaN` = la muestra no trae rumbo. */
  heading: Float32Array;
  /** m/s; `NaN` = la muestra no trae velocidad. */
  speed: Float32Array;
}

export interface StationSeries {
  id: string;
  lon: number;
  lat: number;
  t: Float64Array;
  bikes: Int32Array;
  docks: Int32Array;
}

export interface ValueSeries {
  stationId: string;
  metric: string;
  unit: string;
  t: Float64Array;
  v: Float64Array;
}

export interface ActiveSet {
  /** Inicio de la ventana que contiene el instante (la «actual»). */
  start: number;
  /** Resolución de la ventana actual. */
  resolution: "raw" | "1m";
  /** Había una ventana siguiente cargada al construirlo. */
  hasNext: boolean;
  /** Capas que trae la ventana (aunque vengan vacías). */
  layers: LayerId[];
  mobile: Map<LayerId, MobileSeries[]>;
  stations: StationSeries[];
  series: Map<LayerId, ValueSeries[]>;
}

/**
 * Vida útil de un móvil por capa. `maxGapMs`: mayor hueco entre dos muestras que aún se interpola
 * (más allá, la entidad se queda quieta y reaparece «saltando»; como en directo, M4.2). `holdMs`:
 * cuánto sigue visible tras su última muestra (los umbrales de «viva» de la API: docs M6.2).
 */
export const MOBILE_POLICY: Record<string, { maxGapMs: number; holdMs: number }> = {
  bus: { maxGapMs: 150_000, holdMs: 120_000 },
  ship: { maxGapMs: 180_000, holdMs: 600_000 },
  plane: { maxGapMs: 600_000, holdMs: 300_000 },
  train: { maxGapMs: 150_000, holdMs: 120_000 },
};
const DEFAULT_POLICY = { maxGapMs: 150_000, holdMs: 120_000 };
export const mobilePolicy = (layer: string): { maxGapMs: number; holdMs: number } =>
  MOBILE_POLICY[layer] ?? DEFAULT_POLICY;

interface Point {
  t: number;
  lon: number;
  lat: number;
  h: number;
  s: number;
}

function sortedUnique<T extends { t: number }>(points: T[]): T[] {
  points.sort((a, b) => a.t - b.t);
  const out: T[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.t === p.t) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** Construye las series a partir de la ventana actual y, si está cargada, la siguiente. */
export function buildActive(w0: ReplayWindow, w1: ReplayWindow | null): ActiveSet {
  const windows = w1 ? [w0, w1] : [w0];
  const layers = new Set<LayerId>();
  for (const w of windows) for (const l of Object.keys(w.layers)) layers.add(l as LayerId);

  const mobile = new Map<LayerId, MobileSeries[]>();
  const series = new Map<LayerId, ValueSeries[]>();
  const stationAcc = new Map<
    string,
    { lon: number; lat: number; pts: { t: number; bikes: number; docks: number }[] }
  >();

  for (const layer of layers) {
    const mob = new Map<string, { meta: Meta | undefined; pts: Point[] }>();
    const val = new Map<
      string,
      { stationId: string; metric: string; unit: string; pts: { t: number; v: number }[] }
    >();
    for (const w of windows) {
      const payload = w.layers[layer];
      if (!payload) continue;
      if (payload.kind === "mobile") {
        for (const tr of payload.tracks) {
          const acc = mob.get(tr.id) ?? { meta: undefined, pts: [] };
          mob.set(tr.id, acc);
          if (tr.meta) acc.meta = tr.meta; // la última ventana manda
          if (tr.init) {
            acc.pts.push({
              t: w.from + tr.init.dt,
              lon: fromReplayCoord(tr.init.lon),
              lat: fromReplayCoord(tr.init.lat),
              h: tr.init.heading ?? Number.NaN,
              s: tr.init.speed === undefined ? Number.NaN : fromReplaySpeed(tr.init.speed),
            });
          }
          for (let i = 0; i < tr.ts.length; i++) {
            const hd = tr.heading?.[i];
            const sp = tr.speed?.[i];
            acc.pts.push({
              t: w.from + (tr.ts[i] as number),
              lon: fromReplayCoord(tr.lon[i] as number),
              lat: fromReplayCoord(tr.lat[i] as number),
              h: hd === null || hd === undefined ? Number.NaN : hd,
              s: sp === null || sp === undefined ? Number.NaN : fromReplaySpeed(sp),
            });
          }
        }
      } else if (payload.kind === "station") {
        for (const st of payload.stations) {
          const acc = stationAcc.get(st.id) ?? {
            lon: fromReplayCoord(st.lon),
            lat: fromReplayCoord(st.lat),
            pts: [],
          };
          stationAcc.set(st.id, acc);
          if (st.init)
            acc.pts.push({ t: w.from + st.init.dt, bikes: st.init.bikes, docks: st.init.docks });
          for (let i = 0; i < st.ts.length; i++) {
            acc.pts.push({
              t: w.from + (st.ts[i] as number),
              bikes: st.bikes[i] as number,
              docks: st.docks[i] as number,
            });
          }
        }
      } else {
        for (const se of payload.series) {
          const key = `${se.stationId}:${se.metric}`;
          const acc = val.get(key) ?? {
            stationId: se.stationId,
            metric: se.metric,
            unit: se.unit,
            pts: [],
          };
          val.set(key, acc);
          if (se.init) acc.pts.push({ t: w.from + se.init.dt, v: se.init.value });
          for (let i = 0; i < se.ts.length; i++) {
            acc.pts.push({ t: w.from + (se.ts[i] as number), v: se.value[i] as number });
          }
        }
      }
    }

    if (mob.size > 0) {
      const list: MobileSeries[] = [];
      for (const [id, acc] of mob) {
        const pts = sortedUnique(acc.pts);
        if (pts.length === 0) continue;
        list.push({
          id,
          meta: acc.meta,
          t: Float64Array.from(pts, (p) => p.t),
          lon: Float64Array.from(pts, (p) => p.lon),
          lat: Float64Array.from(pts, (p) => p.lat),
          heading: Float32Array.from(pts, (p) => p.h),
          speed: Float32Array.from(pts, (p) => p.s),
        });
      }
      list.sort(byId);
      mobile.set(layer, list);
    }
    if (val.size > 0) {
      const list: ValueSeries[] = [];
      for (const acc of val.values()) {
        const pts = sortedUnique(acc.pts);
        if (pts.length === 0) continue;
        list.push({
          stationId: acc.stationId,
          metric: acc.metric,
          unit: acc.unit,
          t: Float64Array.from(pts, (p) => p.t),
          v: Float64Array.from(pts, (p) => p.v),
        });
      }
      list.sort((a, b) =>
        a.stationId === b.stationId
          ? a.metric < b.metric
            ? -1
            : 1
          : a.stationId < b.stationId
            ? -1
            : 1,
      );
      series.set(layer, list);
    }
  }

  const stations: StationSeries[] = [];
  for (const [id, acc] of stationAcc) {
    const pts = sortedUnique(acc.pts);
    if (pts.length === 0) continue;
    stations.push({
      id,
      lon: acc.lon,
      lat: acc.lat,
      t: Float64Array.from(pts, (p) => p.t),
      bikes: Int32Array.from(pts, (p) => p.bikes),
      docks: Int32Array.from(pts, (p) => p.docks),
    });
  }
  stations.sort(byId);

  return {
    start: w0.from,
    resolution: w0.resolution,
    hasNext: w1 !== null,
    layers: [...layers],
    mobile,
    stations,
    series,
  };
}

/** Índice de la última muestra con `times[i] <= t`, o −1 si `t` es anterior a todas. */
export function locate(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface Pose {
  lon: number;
  lat: number;
  heading: number;
}

/**
 * Rumbo de la muestra `i`: el dado, o el de la marcha hacia la siguiente (`i+1`) o desde la
 * anterior; 0 si no se movió (la dirección no se inventa con 2 m de ruido).
 */
function headingOf(s: MobileSeries, i: number): number {
  const h = s.heading[i] as number;
  if (!Number.isNaN(h)) return normalizeHeading(h);
  const j = i + 1 < s.t.length ? i + 1 : -1;
  const [a, b] = j >= 0 ? [i, j] : i > 0 ? [i - 1, i] : [i, i];
  const m = bearingAndDistance(
    s.lon[a] as number,
    s.lat[a] as number,
    s.lon[b] as number,
    s.lat[b] as number,
  );
  return m.meters > 2 ? m.bearing : 0;
}

/**
 * Pose de un móvil en `t`, o `null` si aún no existe o ya expiró. Con hueco ≤ `maxGapMs` entre la
 * muestra anterior y la siguiente interpola linealmente (rumbo por el arco corto); si no, se queda
 * en la última hasta `holdMs`. Devuelve el índice de la muestra anterior en `out.index`.
 */
export function samplePose(
  s: MobileSeries,
  t: number,
  policy: { maxGapMs: number; holdMs: number },
  interpolate: boolean,
  out: Pose & { index: number },
): boolean {
  const i = locate(s.t, t);
  if (i < 0) return false;
  const tp = s.t[i] as number;
  const j = i + 1;
  out.index = i;
  if (interpolate && j < s.t.length) {
    const gap = (s.t[j] as number) - tp;
    if (gap <= policy.maxGapMs) {
      const u = (t - tp) / gap;
      out.lon = (s.lon[i] as number) + ((s.lon[j] as number) - (s.lon[i] as number)) * u;
      out.lat = (s.lat[i] as number) + ((s.lat[j] as number) - (s.lat[i] as number)) * u;
      out.heading = lerpHeading(headingOf(s, i), headingOf(s, j), u);
      return true;
    }
  }
  if (t - tp > policy.holdMs) return false;
  out.lon = s.lon[i] as number;
  out.lat = s.lat[i] as number;
  out.heading = headingOf(s, i);
  return true;
}
