import { backoffDelay } from "./backoff.js";
import type { IngestConfig } from "./config.js";
import { type CycleOutcome, nextHealth } from "./health.js";
import type { Clock, IngestAdapter, Logger, Store } from "./types.js";
import { countRows, validateRows } from "./validate.js";

export interface CycleDeps {
  store: Store;
  clock: Clock;
  logger: Logger;
  config: Pick<
    IngestConfig,
    "timeoutMs" | "maxAttempts" | "backoffBaseMs" | "backoffMaxMs" | "downAfter"
  >;
  random?: () => number;
}

class AbortedError extends Error {
  constructor() {
    super("ingesta detenida");
  }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Un intento: `fetch` + `parse` con timeout y cancelación externa (también si el adaptador ignora la señal). */
function attemptOnce(
  adapter: IngestAdapter,
  stop: AbortSignal,
  { clock, config }: Pick<CycleDeps, "clock" | "config">,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    const timer = new AbortController();
    const cleanup = (): void => {
      timer.abort();
      stop.removeEventListener("abort", onStop);
    };
    const onStop = (): void => {
      ctl.abort();
      cleanup();
      reject(new AbortedError());
    };
    if (stop.aborted) return onStop();
    stop.addEventListener("abort", onStop, { once: true });

    void clock.sleep(config.timeoutMs, timer.signal).then(() => {
      if (timer.signal.aborted) return;
      ctl.abort();
      cleanup();
      reject(new Error(`timeout tras ${config.timeoutMs} ms`));
    });

    Promise.resolve()
      .then(() => adapter.fetch(ctl.signal))
      .then((raw) => adapter.parse(raw) as unknown[])
      .then(
        (rows) => (cleanup(), resolve(rows)),
        (e: unknown) => (cleanup(), reject(e)),
      );
  });
}

/**
 * Un ciclo completo de un adaptador: hasta `maxAttempts` intentos con espera creciente, validación,
 * escritura y actualización de `source_health`. Devuelve `null` solo si se detuvo durante el ciclo.
 */
export async function runCycle(
  adapter: IngestAdapter,
  stop: AbortSignal,
  deps: CycleDeps,
): Promise<CycleOutcome | null> {
  const { store, clock, logger, config } = deps;
  const base = { sourceId: adapter.id, intervalMs: adapter.intervalMs };
  let outcome: CycleOutcome;

  try {
    let rows: unknown[] | undefined;
    let latencyMs = 0;
    let lastError: unknown;
    for (let attempt = 1; attempt <= config.maxAttempts && rows === undefined; attempt++) {
      const t0 = clock.now();
      try {
        rows = await attemptOnce(adapter, stop, deps);
        latencyMs = clock.now() - t0;
      } catch (e) {
        if (e instanceof AbortedError) return null;
        lastError = e;
        if (attempt < config.maxAttempts) {
          const wait = backoffDelay(
            attempt,
            { baseMs: config.backoffBaseMs, maxMs: config.backoffMaxMs },
            deps.random,
          );
          logger.warn("intento fallido, se reintenta", {
            source: adapter.id,
            attempt,
            waitMs: wait,
            error: describe(e),
          });
          await clock.sleep(wait, stop);
          if (stop.aborted) return null;
        }
      }
    }
    if (rows === undefined) throw lastError ?? new Error("sin resultado");

    const { valid, rejected, firstError } = validateRows(rows);
    if (rows.length > 0 && rejected === rows.length) {
      throw new Error(`todas las filas inválidas (${rejected}): ${firstError}`);
    }
    if (rejected > 0) {
      logger.warn("filas descartadas por el contrato", {
        source: adapter.id,
        rejected,
        firstError,
      });
    }
    const written = countRows(valid) > 0 ? await store.write(valid) : 0;
    outcome = {
      ...base,
      at: clock.now(),
      ok: true,
      latencyMs,
      rowsWritten: written,
      rowsRejected: rejected,
    };
  } catch (e) {
    logger.error("ciclo fallido", { source: adapter.id, error: describe(e) });
    outcome = {
      ...base,
      at: clock.now(),
      ok: false,
      latencyMs: null,
      rowsWritten: 0,
      rowsRejected: 0,
      error: describe(e),
    };
  }

  try {
    const prev = await store.getHealth(adapter.id);
    await store.saveHealth(nextHealth(prev, outcome, config.downAfter));
  } catch (e) {
    logger.error("no se pudo guardar source_health", { source: adapter.id, error: describe(e) });
  }
  return outcome;
}
