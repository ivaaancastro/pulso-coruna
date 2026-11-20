import type { Sql } from "postgres";
import {
  BIKE_MAX_GAP_MS,
  MOVING_SPEED_MS,
  OBSERVATION_NORMALS,
  emptyAggregates,
  type PulseAggregates,
  type PulseLayer,
} from "./pulse.js";

/** Qué agregar y de dónde: ventana `[from, to)` en tramos de `stepMs`; `layers` = capas con peso > 0. */
export interface PulseQuery {
  from: number;
  to: number;
  stepMs: number;
  layers: readonly PulseLayer[];
  /** Corte brutos/1 min (epoch ms, al minuto), como en replay: brutos `ts >= cutoff`, vistas `bucket < cutoff`. */
  cutoff: number;
}

const UNDEFINED_TABLE = "42P01";
const LOW_RES = {
  positions: "positions_1m",
  stations: "station_status_1m",
  observations: "observations_1m",
};
const MOBILE = ["bus", "ship", "plane"] as const;
const OBSERVED = ["weather", "air", "sea"] as const;
const METRICS = OBSERVED.flatMap((l) => Object.keys(OBSERVATION_NORMALS[l]));

/**
 * Agrega en SQL (no se traen filas) la actividad por tramo. Misma regla de fuentes que `replay-db`
 * (M6.1): `UNION ALL` de los brutos (`ts >= corte`) y las vistas de 1 min (`bucket < corte`), así que
 * cada instante sale de una sola fuente; sin vistas (BD sin M6.1) solo brutos; sin tablas, vacío.
 */
export async function readPulseAggregates(sql: Sql, q: PulseQuery): Promise<PulseAggregates> {
  const out = emptyAggregates();
  const from = new Date(q.from);
  const to = new Date(q.to);
  const cut = new Date(q.cutoff);
  const mobile = MOBILE.filter((l) => q.layers.includes(l));
  const observed = OBSERVED.filter((l) => q.layers.includes(l));
  const idx = (col: string) =>
    sql`floor((extract(epoch from ${sql(col)})::float8 * 1000 - ${q.from}::float8) / ${q.stepMs}::float8)::int`;

  const posSrc = (withLow: boolean) =>
    withLow
      ? sql`(select id, ts, layer, speed from positions where ts >= ${cut}
             union all
             select id, bucket as ts, layer, speed from ${sql(LOW_RES.positions)} where bucket < ${cut}) u`
      : sql`positions u`;
  const stSrc = (withLow: boolean, since: Date) =>
    withLow
      ? sql`(select id, ts, bikes from station_status where ts >= ${cut} and ts >= ${since}
             union all
             select id, bucket as ts, bikes from ${sql(LOW_RES.stations)} where bucket < ${cut} and bucket >= ${since}) u`
      : sql`station_status u`;
  const obsSrc = (withLow: boolean) =>
    withLow
      ? sql`(select layer, metric, ts, value from observations where ts >= ${cut}
             union all
             select layer, metric, bucket as ts, value from ${sql(LOW_RES.observations)} where bucket < ${cut}) u`
      : sql`observations u`;

  /** Con vistas; si no existen, solo brutos; si tampoco hay tabla, vacío. */
  const both = async <T>(run: (withLow: boolean) => PromiseLike<T[]>): Promise<T[]> => {
    for (const withLow of [true, false]) {
      try {
        return await run(withLow);
      } catch (e) {
        if ((e as { code?: string }).code !== UNDEFINED_TABLE) throw e;
      }
    }
    return [];
  };

  const tasks: Promise<void>[] = [];

  if (mobile.length > 0) {
    tasks.push(
      both(
        (w) => sql<{ layer: (typeof MOBILE)[number]; idx: number; moving: number }[]>`
        select layer, ${idx("ts")} as idx,
               count(distinct id) filter (where speed is null or speed >= ${MOVING_SPEED_MS}::float8)::int as moving
        from ${posSrc(w)}
        where layer in ${sql(mobile)} and ts >= ${from} and ts < ${to}
        group by 1, 2`,
      ).then((r) => {
        out.mobile = r;
      }),
    );
  }

  if (q.layers.includes("bike")) {
    const since = new Date(q.from - BIKE_MAX_GAP_MS);
    tasks.push(
      both(
        (w) => sql<{ idx: number; rotation: number }[]>`
        select ${idx("ts")} as idx, sum(abs(bikes - prev))::int as rotation
        from (
          select ts, bikes,
                 lag(bikes) over (partition by id order by ts) as prev,
                 lag(ts) over (partition by id order by ts) as prev_ts
          from ${stSrc(w, since)}
          where ts < ${to}
        ) s
        where prev is not null and ts >= ${from}
          and ts - prev_ts <= ${BIKE_MAX_GAP_MS / 1000} * interval '1 second'
        group by 1`,
      ).then((r) => {
        out.bike = r;
      }),
    );
  }

  if (observed.length > 0) {
    tasks.push(
      both(
        (w) => sql<
          { layer: (typeof OBSERVED)[number]; metric: string; idx: number; avg: number }[]
        >`
        select layer, metric, ${idx("ts")} as idx, avg(value)::float8 as avg
        from ${obsSrc(w)}
        where layer in ${sql(observed)} and metric in ${sql(METRICS)} and ts >= ${from} and ts < ${to}
        group by 1, 2, 3`,
      ).then((r) => {
        out.obs = r;
      }),
    );
  }

  await Promise.all(tasks);
  return out;
}
