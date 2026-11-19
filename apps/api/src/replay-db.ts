import { OBSERVATION_LAYER_IDS, type LayerId, type ReplayResolution } from "@pulso/schema";
import type { Sql } from "postgres";

/** Qué leer para una ventana `[from, to)` y de dónde. */
export interface ReplayQuery {
  from: number;
  to: number;
  layers: readonly LayerId[];
  resolution: ReplayResolution;
  /**
   * Corte brutos/1 min (epoch ms, al minuto): brutos con `ts >= cutoff`, vistas de 1 min con `bucket < cutoff`.
   * Una ventana que lo cruza mezcla ambas cadencias.
   */
  cutoff: number;
  /** Hasta dónde mirar atrás para el estado inicial (ms), por tipo de dato. */
  lookbackMs: { entity: number; station: number; observation: number };
  /** Tope de filas por tabla (se lee una de más para detectar el desbordamiento). */
  maxRows: number;
}

export interface PositionSample {
  id: string;
  layer: LayerId;
  ts: number;
  lon: number;
  lat: number;
  heading: number | null;
  speed: number | null;
  /** Solo en muestras brutas: la vista de 1 min no conserva `meta`. */
  meta: Record<string, string | number> | null;
}
export interface StationSample {
  id: string;
  ts: number;
  lon: number;
  lat: number;
  bikes: number;
  docks: number;
}
export interface ObservationSample {
  stationId: string;
  metric: string;
  layer: LayerId;
  ts: number;
  value: number;
  unit: string;
}

/** Filas crudas de la ventana (`rows`) y último valor anterior a `from` (`init`), ya con `ts` en epoch ms. */
export interface ReplayRows {
  resolution: ReplayResolution;
  positions: { init: PositionSample[]; rows: PositionSample[] };
  stations: { init: StationSample[]; rows: StationSample[] };
  observations: { init: ObservationSample[]; rows: ObservationSample[] };
  /** Alguna tabla superó `maxRows`: el resultado está incompleto y no debe servirse. */
  truncated: boolean;
}

export const emptyReplayRows = (resolution: ReplayResolution): ReplayRows => ({
  resolution,
  positions: { init: [], rows: [] },
  stations: { init: [], rows: [] },
  observations: { init: [], rows: [] },
  truncated: false,
});

const UNDEFINED_TABLE = "42P01";
/** Vistas de 1 min de M6.1 (columna temporal `bucket`). */
const LOW_RES = {
  positions: "positions_1m",
  stations: "station_status_1m",
  observations: "observations_1m",
};
const MOBILE = new Set<string>(["bus", "ship", "plane", "train"]);
const OBSERVATION = new Set<string>(OBSERVATION_LAYER_IDS);

/** Tabla inexistente (ingesta sin migrar) = sin datos, como en el resto de la API. */
async function orEmpty<T>(q: PromiseLike<T[]>): Promise<T[]> {
  try {
    return await q;
  } catch (e) {
    if ((e as { code?: string }).code === UNDEFINED_TABLE) return [];
    throw e;
  }
}

type PosRaw = Omit<PositionSample, "ts"> & { ts: Date };
type StRaw = Omit<StationSample, "ts"> & { ts: Date };
type ObsRaw = Omit<ObservationSample, "ts"> & { ts: Date };

const pos = (r: PosRaw): PositionSample => ({ ...r, ts: r.ts.getTime() });
const st = (r: StRaw): StationSample => ({ ...r, ts: r.ts.getTime() });
const obs = (r: ObsRaw): ObservationSample => ({ ...r, ts: r.ts.getTime() });

/**
 * Lee de TimescaleDB las filas de una ventana y el último valor anterior de cada entidad.
 *
 * Fuente = UNION ALL de la tabla bruta (`ts >= cutoff`) y la vista de 1 min (`bucket < cutoff`), tal
 * como documenta M6.1: cada instante sale de una sola fuente, sin duplicados, y una ventana que cruza
 * el corte mezcla ambas cadencias. Si las vistas no existen (BD sin migrar a M6.1) se usan solo los
 * brutos. `q.resolution` solo se copia al resultado (la fija el llamador con `replayResolution`).
 */
export async function readReplayRows(sql: Sql, q: ReplayQuery): Promise<ReplayRows> {
  const out = emptyReplayRows(q.resolution);
  const from = new Date(q.from);
  const to = new Date(q.to);
  const cut = new Date(q.cutoff);
  const limit = q.maxRows + 1;
  const mobile = q.layers.filter((l) => MOBILE.has(l));
  const observed = q.layers.filter((l) => OBSERVATION.has(l));
  const wantStations = q.layers.includes("bike");
  const since = (ms: number): Date => new Date(q.from - ms);
  const tasks: Promise<void>[] = [];

  /** `withLow`: incluye la vista de 1 min; si no existe, se reintenta solo con brutos. */
  const posSrc = (withLow: boolean) =>
    withLow
      ? sql`(select id, ts, layer, lon, lat, heading, speed, meta from positions where ts >= ${cut}
             union all
             select id, bucket as ts, layer, lon, lat, heading, speed, null::jsonb as meta from ${sql(LOW_RES.positions)} where bucket < ${cut}) u`
      : sql`positions u`;
  const stSrc = (withLow: boolean) =>
    withLow
      ? sql`(select id, ts, lon, lat, bikes, docks from station_status where ts >= ${cut}
             union all
             select id, bucket as ts, lon, lat, bikes, docks from ${sql(LOW_RES.stations)} where bucket < ${cut}) u`
      : sql`station_status u`;
  const obsSrc = (withLow: boolean) =>
    withLow
      ? sql`(select station_id, metric, layer, ts, value, unit from observations where ts >= ${cut}
             union all
             select station_id, metric, layer, bucket as ts, value, unit from ${sql(LOW_RES.observations)} where bucket < ${cut}) u`
      : sql`observations u`;
  const both = async <T>(run: (withLow: boolean) => PromiseLike<T[]>): Promise<T[]> => {
    try {
      return await run(true);
    } catch (e) {
      if ((e as { code?: string }).code !== UNDEFINED_TABLE) throw e;
    }
    return orEmpty(run(false));
  };

  if (mobile.length > 0) {
    const layers = sql(mobile);
    tasks.push(
      both(
        (w) => sql<PosRaw[]>`
        select id, ts, layer, lon, lat, heading, speed, meta from ${posSrc(w)}
        where layer in ${layers} and ts >= ${from} and ts < ${to}
        order by id, ts limit ${limit}`,
      ).then((r) => {
        out.positions.rows = r.slice(0, q.maxRows).map(pos);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      both(
        (w) => sql<PosRaw[]>`
        select distinct on (id) id, ts, layer, lon, lat, heading, speed, meta from ${posSrc(w)}
        where layer in ${layers} and ts >= ${since(q.lookbackMs.entity)} and ts < ${from}
        order by id, ts desc`,
      ).then((r) => {
        out.positions.init = r.map(pos);
      }),
    );
  }

  if (wantStations) {
    tasks.push(
      both(
        (w) => sql<StRaw[]>`
        select id, ts, lon, lat, bikes, docks from ${stSrc(w)}
        where ts >= ${from} and ts < ${to}
        order by id, ts limit ${limit}`,
      ).then((r) => {
        out.stations.rows = r.slice(0, q.maxRows).map(st);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      both(
        (w) => sql<StRaw[]>`
        select distinct on (id) id, ts, lon, lat, bikes, docks from ${stSrc(w)}
        where ts >= ${since(q.lookbackMs.station)} and ts < ${from}
        order by id, ts desc`,
      ).then((r) => {
        out.stations.init = r.map(st);
      }),
    );
  }

  if (observed.length > 0) {
    const layers = sql(observed);
    tasks.push(
      both(
        (w) => sql<ObsRaw[]>`
        select station_id as "stationId", metric, layer, ts, value, unit from ${obsSrc(w)}
        where layer in ${layers} and ts >= ${from} and ts < ${to}
        order by station_id, metric, ts limit ${limit}`,
      ).then((r) => {
        out.observations.rows = r.slice(0, q.maxRows).map(obs);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      both(
        (w) => sql<ObsRaw[]>`
        select distinct on (layer, station_id, metric) station_id as "stationId", metric, layer, ts, value, unit
        from ${obsSrc(w)}
        where layer in ${layers} and ts >= ${since(q.lookbackMs.observation)} and ts < ${from}
        order by layer, station_id, metric, ts desc`,
      ).then((r) => {
        out.observations.init = r.map(obs);
      }),
    );
  }

  await Promise.all(tasks);
  return out;
}
