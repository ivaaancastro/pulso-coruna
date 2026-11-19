import { OBSERVATION_LAYER_IDS, type LayerId, type ReplayResolution } from "@pulso/schema";
import type { Sql } from "postgres";

/** Qué leer para una ventana `[from, to)` y de dónde. */
export interface ReplayQuery {
  from: number;
  to: number;
  layers: readonly LayerId[];
  resolution: ReplayResolution;
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
  /** Solo en `raw`: la tabla de 1 min no conserva `meta`. */
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
const MOBILE = new Set<string>(["bus", "ship", "plane", "train"]);
const OBSERVATION = new Set<string>(OBSERVATION_LAYER_IDS);

/** Tabla/vista y columna de tiempo según la resolución (las vistas de 1 min son de M6.1, migración 0002). */
const SOURCES = {
  raw: {
    positions: ["positions", "ts"],
    stations: ["station_status", "ts"],
    observations: ["observations", "ts"],
  },
  "1m": {
    positions: ["positions_1m", "bucket"],
    stations: ["station_status_1m", "bucket"],
    observations: ["observations_1m", "bucket"],
  },
} as const;

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
 * Punto de extensión de la resolución: `q.resolution` decide la tabla (`SOURCES`). La elige el
 * llamador (`replayResolution`): `raw` dentro de `API_REPLAY_RAW_DAYS`, `1m` más atrás. Una ventana
 * nunca mezcla ambas: se decide por su `from` (≤ 5 min de solape con el límite no importan, la vista
 * de 1 min cubre todo lo anterior a la retención y los brutos se conservan 30 días).
 */
export async function readReplayRows(sql: Sql, q: ReplayQuery): Promise<ReplayRows> {
  const out = emptyReplayRows(q.resolution);
  const from = new Date(q.from);
  const to = new Date(q.to);
  const limit = q.maxRows + 1;
  const raw = q.resolution === "raw";
  const mobile = q.layers.filter((l) => MOBILE.has(l));
  const observed = q.layers.filter((l) => OBSERVATION.has(l));
  const wantStations = q.layers.includes("bike");
  const since = (ms: number): Date => new Date(q.from - ms);
  const tasks: Promise<void>[] = [];

  if (mobile.length > 0) {
    const [table, tsCol] = SOURCES[q.resolution].positions;
    const t = sql(table);
    const c = sql(tsCol);
    const meta = raw ? sql`meta` : sql`null::jsonb as meta`;
    const layers = sql(mobile);
    tasks.push(
      orEmpty(sql<PosRaw[]>`
        select id, ${c} as ts, layer, lon, lat, heading, speed, ${meta} from ${t}
        where layer in ${layers} and ${c} >= ${from} and ${c} < ${to}
        order by id, ${c} limit ${limit}`).then((r) => {
        out.positions.rows = r.slice(0, q.maxRows).map(pos);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      orEmpty(sql<PosRaw[]>`
        select distinct on (id) id, ${c} as ts, layer, lon, lat, heading, speed, ${meta} from ${t}
        where layer in ${layers} and ${c} >= ${since(q.lookbackMs.entity)} and ${c} < ${from}
        order by id, ${c} desc`).then((r) => {
        out.positions.init = r.map(pos);
      }),
    );
  }

  if (wantStations) {
    const [table, tsCol] = SOURCES[q.resolution].stations;
    const t = sql(table);
    const c = sql(tsCol);
    tasks.push(
      orEmpty(sql<StRaw[]>`
        select id, ${c} as ts, lon, lat, bikes, docks from ${t}
        where ${c} >= ${from} and ${c} < ${to}
        order by id, ${c} limit ${limit}`).then((r) => {
        out.stations.rows = r.slice(0, q.maxRows).map(st);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      orEmpty(sql<StRaw[]>`
        select distinct on (id) id, ${c} as ts, lon, lat, bikes, docks from ${t}
        where ${c} >= ${since(q.lookbackMs.station)} and ${c} < ${from}
        order by id, ${c} desc`).then((r) => {
        out.stations.init = r.map(st);
      }),
    );
  }

  if (observed.length > 0) {
    const [table, tsCol] = SOURCES[q.resolution].observations;
    const t = sql(table);
    const c = sql(tsCol);
    const layers = sql(observed);
    tasks.push(
      orEmpty(sql<ObsRaw[]>`
        select station_id as "stationId", metric, layer, ${c} as ts, value, unit from ${t}
        where layer in ${layers} and ${c} >= ${from} and ${c} < ${to}
        order by station_id, metric, ${c} limit ${limit}`).then((r) => {
        out.observations.rows = r.slice(0, q.maxRows).map(obs);
        if (r.length > q.maxRows) out.truncated = true;
      }),
      orEmpty(sql<ObsRaw[]>`
        select distinct on (station_id, metric) station_id as "stationId", metric, layer, ${c} as ts, value, unit
        from ${t}
        where layer in ${layers} and ${c} >= ${since(q.lookbackMs.observation)} and ${c} < ${from}
        order by station_id, metric, ${c} desc`).then((r) => {
        out.observations.init = r.map(obs);
      }),
    );
  }

  await Promise.all(tasks);
  return out;
}
