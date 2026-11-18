import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { type BackoffOptions, backoffDelay } from "../backoff.js";
import type { Clock, Logger } from "../types.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** Clave arbitraria del advisory lock que serializa migraciones concurrentes. */
const LOCK_KEY = 7_303_5;

/**
 * Aplica las migraciones `NNNN_nombre.sql` pendientes, en orden, dentro de una transacción con
 * advisory lock. Idempotente: volver a ejecutarla no hace nada. Devuelve las versiones aplicadas ahora.
 */
export async function migrate(sql: Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
    await tx`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set(
      (await tx<{ version: string }[]>`select version from schema_migrations`).map(
        (r) => r.version,
      ),
    );
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(`${dir}${file}`, "utf8"));
      await tx`insert into schema_migrations (version) values (${file})`;
      applied.push(file);
    }
    return applied;
  });
}

export interface MigrateRetryOptions {
  attempts: number;
  backoff: BackoffOptions;
  clock: Clock;
  logger: Logger;
  signal?: AbortSignal;
  run?: () => Promise<string[]>;
}

/** `migrate` con reintentos y espera creciente; relanza el último error si se agotan. */
export async function migrateWithRetry(sql: Sql, o: MigrateRetryOptions): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await (o.run ?? (() => migrate(sql)))();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (attempt >= o.attempts || o.signal?.aborted) {
        o.logger.error("no se pudo migrar la BD, abandonando", { attempt, error });
        throw e;
      }
      const waitMs = backoffDelay(attempt, o.backoff);
      o.logger.warn("BD no disponible o migración fallida, se reintenta", {
        attempt,
        waitMs,
        error,
      });
      await o.clock.sleep(waitMs, o.signal);
    }
  }
}
