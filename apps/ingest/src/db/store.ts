import postgres, { type Sql } from "postgres";
import type { SourceHealth, Store, ValidRows } from "../types.js";

export const connect = (databaseUrl: string): Sql =>
  postgres(databaseUrl, { max: 4, onnotice: () => {} });

/** Filas por INSERT: con 8 columnas queda muy por debajo del límite de 65 535 parámetros. */
const BATCH = 1000;

const chunks = <T>(items: readonly T[], size = BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const toDate = (ms: number): Date => new Date(ms);
const toMs = (d: Date | null): number | null => (d === null ? null : d.getTime());

interface HealthRow {
  source_id: string;
  status: SourceHealth["status"];
  interval_ms: number;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error: string | null;
  consecutive_failures: number;
  last_latency_ms: number | null;
  rows_written_last: number;
  rows_written_total: string; // bigint llega como string
  rows_rejected_last: number;
  updated_at: Date;
}

export class PgStore implements Store {
  constructor(private readonly sql: Sql) {}

  async write(rows: ValidRows): Promise<number> {
    const { sql } = this;
    return sql.begin(async (tx) => {
      let inserted = 0;
      for (const batch of chunks(rows.positions)) {
        const values = batch.map((e) => ({
          id: e.id,
          ts: toDate(e.ts),
          layer: e.layer,
          lon: e.lon,
          lat: e.lat,
          heading: e.heading ?? null,
          speed: e.speed ?? null,
          meta: e.meta === undefined ? null : tx.json(e.meta),
        }));
        inserted += (await tx`insert into positions ${tx(values)} on conflict (id, ts) do nothing`)
          .count;
      }
      for (const batch of chunks(rows.stations)) {
        const values = batch.map((s) => ({ ...s, ts: toDate(s.ts) }));
        inserted += (
          await tx`insert into station_status ${tx(values)} on conflict (id, ts) do nothing`
        ).count;
      }
      for (const batch of chunks(rows.observations)) {
        const values = batch.map((o) => ({
          station_id: o.stationId,
          metric: o.metric,
          ts: toDate(o.ts),
          layer: o.layer,
          value: o.value,
          unit: o.unit,
        }));
        inserted += (
          await tx`insert into observations ${tx(values)} on conflict (station_id, metric, ts) do nothing`
        ).count;
      }
      return inserted;
    });
  }

  async getHealth(sourceId: string): Promise<SourceHealth | null> {
    const [r] = await this.sql<
      HealthRow[]
    >`select * from source_health where source_id = ${sourceId}`;
    if (!r) return null;
    return {
      sourceId: r.source_id,
      status: r.status,
      intervalMs: r.interval_ms,
      lastSuccessAt: toMs(r.last_success_at),
      lastErrorAt: toMs(r.last_error_at),
      lastError: r.last_error,
      consecutiveFailures: r.consecutive_failures,
      lastLatencyMs: r.last_latency_ms,
      rowsWrittenLast: r.rows_written_last,
      rowsWrittenTotal: Number(r.rows_written_total),
      rowsRejectedLast: r.rows_rejected_last,
      updatedAt: r.updated_at.getTime(),
    };
  }

  async saveHealth(h: SourceHealth): Promise<void> {
    const ms = (n: number | null): Date | null => (n === null ? null : toDate(n));
    await this.sql`
      insert into source_health (
        source_id, status, interval_ms, last_success_at, last_error_at, last_error,
        consecutive_failures, last_latency_ms, rows_written_last, rows_written_total,
        rows_rejected_last, updated_at
      ) values (
        ${h.sourceId}, ${h.status}, ${h.intervalMs}, ${ms(h.lastSuccessAt)}, ${ms(h.lastErrorAt)},
        ${h.lastError}, ${h.consecutiveFailures}, ${h.lastLatencyMs}, ${h.rowsWrittenLast},
        ${h.rowsWrittenTotal}, ${h.rowsRejectedLast}, ${toDate(h.updatedAt)}
      )
      on conflict (source_id) do update set
        status = excluded.status,
        interval_ms = excluded.interval_ms,
        last_success_at = excluded.last_success_at,
        last_error_at = excluded.last_error_at,
        last_error = excluded.last_error,
        consecutive_failures = excluded.consecutive_failures,
        last_latency_ms = excluded.last_latency_ms,
        rows_written_last = excluded.rows_written_last,
        rows_written_total = excluded.rows_written_total,
        rows_rejected_last = excluded.rows_rejected_last,
        updated_at = excluded.updated_at`;
  }
}
