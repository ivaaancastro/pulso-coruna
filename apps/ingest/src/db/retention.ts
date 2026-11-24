import type { Sql } from "postgres";
import type { Clock, Logger } from "../types.js";

/**
 * Retención (M6.1, ADR-0024): brutos `rawDays` días; más allá, 1 muestra/min/entidad (la última del minuto).
 *
 * Tablas/vistas para quien lea el histórico (M6.2): ver `LOW_RES` y docs/specs/M6.1-retencion.md.
 */
export interface RetentionTarget {
  /** Hypertable bruta. */
  raw: string;
  /** Agregado continuo de baja resolución (1 fila por minuto y entidad). */
  lowRes: string;
}

export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  { raw: "positions", lowRes: "positions_1m" },
  { raw: "station_status", lowRes: "station_status_1m" },
  { raw: "observations", lowRes: "observations_1m" },
];

/** Nombres de las vistas de baja resolución (columna temporal: `bucket`). */
export const LOW_RES = {
  positions: "positions_1m",
  stationStatus: "station_status_1m",
  observations: "observations_1m",
} as const;

export interface RetentionConfig {
  enabled: boolean;
  /** Días de datos brutos (por defecto 30). */
  rawDays: number;
  /** Cada cuánto se ejecuta el job. */
  intervalMs: number;
  /** statement_timeout del job: una puesta al día tras días parado puede tardar. */
  statementTimeoutMs: number;
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** Instante de corte: `now - rawDays`, redondeado hacia abajo al minuto (frontera de los agregados). */
export function cutoffFor(nowMs: number, rawDays: number): Date {
  const t = nowMs - rawDays * DAY_MS;
  return new Date(Math.floor(t / MIN_MS) * MIN_MS);
}

export interface TargetResult {
  target: string;
  cutoff: Date;
  droppedChunks: number;
  error?: string;
}

/** SQLSTATE 40P01 (deadlock_detected) o 40001 (serialization_failure): reintentables. */
function isTransientLockError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "40P01" || code === "40001";
}

/** Ejecuta `fn` reintentando hasta 4 veces (200 ms, 400 ms, 800 ms) si falla por deadlock. */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !isTransientLockError(e)) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

/** Clave del advisory lock del job (distinta de la de migraciones). */
const LOCK_KEY = 7_303_6;

/**
 * Una pasada. Por tabla: (1) refresca el agregado hasta `cutoff` (si faltaban días por agregar, se
 * ponen al día aquí: el refresco procesa todas las invalidaciones pendientes), (2) solo si eso salió
 * bien, `drop_chunks` de los chunks enteros anteriores a `cutoff`. Idempotente: repetirla no hace nada.
 * Un fallo en una tabla no impide procesar las demás y nunca llega a borrar sin haber agregado.
 * Devuelve `null` si otra instancia ya la está ejecutando.
 */
export async function runRetention(
  sql: Sql,
  o: { nowMs: number; rawDays: number; logger: Logger },
): Promise<TargetResult[] | null> {
  const cutoff = cutoffFor(o.nowMs, o.rawDays);
  const cutoffIso = cutoff.toISOString();
  // refresh_continuous_aggregate no admite transacciones: conexión reservada, sin `begin`.
  const conn = await sql.reserve();
  try {
    const [lock] = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
    if (!lock?.ok) return null;
    try {
      const results: TargetResult[] = [];
      for (const t of RETENTION_TARGETS) {
        const r: TargetResult = { target: t.raw, cutoff, droppedChunks: 0 };
        try {
          // Los identificadores son constantes de este módulo; los instantes van como parámetros.
          // Ventana = [primer bruto que queda, corte): cubre todo lo que aún no se ha agregado (también
          // días atrasados) pero NO la zona ya borrada: drop_chunks invalida el agregado y refrescarla
          // lo vaciaría (ver spec, «Trampa de las invalidaciones»).
          const [first] = await conn.unsafe<{ t: Date | null }[]>(
            `select min(ts) as t from ${t.raw}`,
          );
          if (first?.t && first.t.getTime() < cutoff.getTime()) {
            const start = new Date(Math.floor(first.t.getTime() / MIN_MS) * MIN_MS);
            // Los jobs de fondo de Timescale (política de refresco del agregado) pueden competir por
            // los mismos locks: un deadlock es transitorio y ambos pasos son idempotentes, así que se
            // reintenta unas pocas veces antes de darlo por fallo.
            const dropped = await withDeadlockRetry(async () => {
              await conn.unsafe(
                `call refresh_continuous_aggregate('${t.lowRes}', $1::timestamptz, $2::timestamptz)`,
                [start.toISOString(), cutoffIso],
              );
              return conn.unsafe(
                `select drop_chunks('${t.raw}', older_than => $1::timestamptz) as c`,
                [cutoffIso],
              );
            });
            r.droppedChunks = dropped.length;
          }
        } catch (e) {
          r.error = e instanceof Error ? e.message : String(e);
        }
        const success = r.error ? null : new Date(o.nowMs);
        await conn`
          insert into retention_status (target, last_run_at, last_success_at, last_error, cutoff, dropped_last, dropped_total)
          values (${t.raw}, ${new Date(o.nowMs)}, ${success}, ${r.error ?? null}, ${cutoff},
                  ${r.droppedChunks}, ${r.droppedChunks})
          on conflict (target) do update set
            last_run_at = excluded.last_run_at,
            last_success_at = coalesce(excluded.last_success_at, retention_status.last_success_at),
            last_error = excluded.last_error,
            cutoff = excluded.cutoff,
            dropped_last = excluded.dropped_last,
            dropped_total = retention_status.dropped_total + excluded.dropped_last`;
        if (r.error) {
          o.logger.error("retención fallida", { target: t.raw, error: r.error });
        } else {
          o.logger.info("retención", {
            target: t.raw,
            cutoff: cutoffIso,
            droppedChunks: r.droppedChunks,
          });
        }
        results.push(r);
      }
      return results;
    } finally {
      await conn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/**
 * Bucle del job: una pasada al arrancar y luego cada `intervalMs`. Nunca lanza (errores a log);
 * termina al llamar a `stop()`.
 */
export function startRetention(
  sql: Sql,
  o: { config: RetentionConfig; clock: Clock; logger: Logger },
): { stop(): Promise<void> } {
  const ac = new AbortController();
  const { config, clock, logger } = o;
  if (!config.enabled) {
    logger.warn(
      "retención desactivada (INGEST_RETENTION_ENABLED=false): los brutos crecen sin límite",
    );
    return { async stop() {} };
  }
  logger.info("retención activa", { rawDays: config.rawDays, intervalMs: config.intervalMs });
  const loop = (async () => {
    while (!ac.signal.aborted) {
      try {
        const res = await runRetention(sql, {
          nowMs: clock.now(),
          rawDays: config.rawDays,
          logger,
        });
        if (res === null) logger.info("retención: otra instancia en curso, se omite");
      } catch (e) {
        logger.error("retención: error inesperado", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await clock.sleep(config.intervalMs, ac.signal);
    }
  })();
  return {
    async stop() {
      ac.abort();
      await loop;
    },
  };
}
