import {
  LAYER_IDS,
  type Entity,
  type LayerId,
  type LayerItem,
  type Observation,
  type StationStatus,
} from "@pulso/schema";
import postgres, { type Sql } from "postgres";
import type { ApiConfig } from "./config.js";
import { readReplayRows, type ReplayQuery, type ReplayRows } from "./replay-db.js";

/** Último estado conocido de cada capa (todas presentes; sin datos = lista vacía). */
export interface Latest {
  ts: number;
  layers: Record<LayerId, LayerItem[]>;
}

export type SourceStatus = "ok" | "degraded" | "down";

/** Fila de `source_health` (tiempos epoch ms UTC). */
export interface SourceHealthRow {
  sourceId: string;
  status: SourceStatus;
  intervalMs: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  consecutiveFailures: number;
  updatedAt: number;
}

/** Lo que la API necesita de la BD. Postgres en producción, memoria en los tests unitarios. */
export interface DataSource {
  /** Último estado por capa. `maxCacheMs`: tolera un resultado de hasta esa edad (las llamadas concurrentes se unen). */
  latest(maxCacheMs?: number): Promise<Latest>;
  sourceHealth(): Promise<SourceHealthRow[]>;
  /** Marca de la última lectura de cada capa (ventana de 24 h); sin entrada = sin datos. */
  layerFreshness(): Promise<Partial<Record<LayerId, number>>>;
  /** Histórico de una ventana (M6.2): filas de la tabla bruta o de la de 1 min según `q.resolution`. */
  replay(q: ReplayQuery): Promise<ReplayRows>;
  /** Latencia (ms) de un `select 1`; lanza si la BD no responde. */
  ping(): Promise<number>;
  close(): Promise<void>;
}

export const connect = (databaseUrl: string, c: ApiConfig): Sql =>
  postgres(databaseUrl, {
    max: 4,
    onnotice: () => {},
    connect_timeout: c.dbConnectTimeoutS,
    idle_timeout: c.dbIdleTimeoutS,
    max_lifetime: c.dbMaxLifetimeS,
    connection: { statement_timeout: c.dbStatementTimeoutMs },
  });

const emptyLayers = (): Record<LayerId, LayerItem[]> =>
  Object.fromEntries(LAYER_IDS.map((l) => [l, [] as LayerItem[]])) as Record<LayerId, LayerItem[]>;

const FRESHNESS_WINDOW_MS = 24 * 60 * 60_000;
const UNDEFINED_TABLE = "42P01";

interface PositionRow {
  id: string;
  ts: Date;
  layer: Entity["layer"];
  lon: number;
  lat: number;
  heading: number | null;
  speed: number | null;
  meta: Entity["meta"] | null;
}
interface StationRow {
  id: string;
  ts: Date;
  lon: number;
  lat: number;
  bikes: number;
  docks: number;
}
interface ObservationRow {
  station_id: string;
  metric: string;
  ts: Date;
  layer: Observation["layer"];
  value: number;
  unit: string;
}

const toEntity = (r: PositionRow): Entity => ({
  id: r.id,
  layer: r.layer,
  lon: r.lon,
  lat: r.lat,
  ...(r.heading !== null && { heading: r.heading }),
  ...(r.speed !== null && { speed: r.speed }),
  ts: r.ts.getTime(),
  ...(r.meta !== null && { meta: r.meta }),
});
const toStation = (r: StationRow): StationStatus => ({
  id: r.id,
  layer: "bike",
  lon: r.lon,
  lat: r.lat,
  bikes: r.bikes,
  docks: r.docks,
  ts: r.ts.getTime(),
});
const toObservation = (r: ObservationRow): Observation => ({
  stationId: r.station_id,
  layer: r.layer,
  metric: r.metric,
  value: r.value,
  unit: r.unit,
  ts: r.ts.getTime(),
});

export class PgDataSource implements DataSource {
  private cached: { at: number; value: Latest } | undefined;
  private inflight: Promise<Latest> | undefined;
  private warnedMissing = false;

  constructor(
    private readonly sql: Sql,
    private readonly maxAgeMs: ApiConfig["maxAgeMs"],
    private readonly now: () => number = Date.now,
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  /** Si la ingesta aún no ha migrado, las tablas no existen: eso es «sin datos», no un error. */
  private async orEmpty<T>(q: PromiseLike<T[]>): Promise<T[]> {
    try {
      return await q;
    } catch (e) {
      if ((e as { code?: string }).code === UNDEFINED_TABLE) {
        if (!this.warnedMissing) {
          this.warnedMissing = true;
          this.warn("tablas inexistentes: la ingesta aún no ha migrado la BD");
        }
        return [];
      }
      throw e;
    }
  }

  latest(maxCacheMs = 0): Promise<Latest> {
    const t = this.now();
    if (this.cached && t - this.cached.at <= maxCacheMs) return Promise.resolve(this.cached.value);
    // Las lecturas concurrentes comparten una sola consulta.
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async load(): Promise<Latest> {
    const startedAt = this.now();
    const cut = (ms: number): Date => new Date(startedAt - ms);
    const { sql } = this;
    const [positions, stations, observations] = await Promise.all([
      this.orEmpty(sql<PositionRow[]>`
        select distinct on (id) id, ts, layer, lon, lat, heading, speed, meta
        from positions where ts > ${cut(this.maxAgeMs.entity)} order by id, ts desc`),
      this.orEmpty(sql<StationRow[]>`
        select distinct on (id) id, ts, lon, lat, bikes, docks
        from station_status where ts > ${cut(this.maxAgeMs.station)} order by id, ts desc`),
      this.orEmpty(sql<ObservationRow[]>`
        select distinct on (station_id, metric) station_id, metric, ts, layer, value, unit
        from observations where ts > ${cut(this.maxAgeMs.observation)}
        order by station_id, metric, ts desc`),
    ]);
    const layers = emptyLayers();
    for (const r of positions) layers[r.layer]?.push(toEntity(r));
    for (const r of stations) layers.bike.push(toStation(r));
    for (const r of observations) layers[r.layer]?.push(toObservation(r));
    const value: Latest = { ts: startedAt, layers };
    this.cached = { at: startedAt, value };
    return value;
  }

  async sourceHealth(): Promise<SourceHealthRow[]> {
    const rows = await this.orEmpty(this.sql<
      {
        source_id: string;
        status: SourceStatus;
        interval_ms: number;
        last_success_at: Date | null;
        last_error_at: Date | null;
        consecutive_failures: number;
        updated_at: Date;
      }[]
    >`select source_id, status, interval_ms, last_success_at, last_error_at, consecutive_failures, updated_at
      from source_health order by source_id`);
    return rows.map((r) => ({
      sourceId: r.source_id,
      status: r.status,
      intervalMs: r.interval_ms,
      lastSuccessAt: r.last_success_at?.getTime() ?? null,
      lastErrorAt: r.last_error_at?.getTime() ?? null,
      consecutiveFailures: r.consecutive_failures,
      updatedAt: r.updated_at.getTime(),
    }));
  }

  async layerFreshness(): Promise<Partial<Record<LayerId, number>>> {
    const since = new Date(this.now() - FRESHNESS_WINDOW_MS);
    const { sql } = this;
    type Row = { layer: LayerId; last: Date };
    const [p, s, o] = await Promise.all([
      this.orEmpty(
        sql<Row[]>`select layer, max(ts) as last from positions where ts > ${since} group by layer`,
      ),
      this.orEmpty(
        sql<
          Row[]
        >`select layer, max(ts) as last from station_status where ts > ${since} group by layer`,
      ),
      this.orEmpty(
        sql<
          Row[]
        >`select layer, max(ts) as last from observations where ts > ${since} group by layer`,
      ),
    ]);
    const out: Partial<Record<LayerId, number>> = {};
    for (const r of [...p, ...s, ...o]) {
      const ms = r.last.getTime();
      if (!(r.layer in out) || ms > (out[r.layer] ?? 0)) out[r.layer] = ms;
    }
    return out;
  }

  replay(q: ReplayQuery): Promise<ReplayRows> {
    return readReplayRows(this.sql, q);
  }

  async ping(): Promise<number> {
    const t = performance.now();
    await this.sql`select 1`;
    return Math.round(performance.now() - t);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
