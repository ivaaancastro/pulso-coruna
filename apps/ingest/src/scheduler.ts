import { type CycleDeps, runCycle } from "./cycle.js";
import type { IngestAdapter } from "./types.js";

export interface Scheduler {
  /** Aborta las esperas y los intentos en vuelo, y espera a que todos los bucles terminen. */
  stop(): Promise<void>;
  /** Se resuelve cuando todos los bucles han terminado (solo tras `stop`). */
  done: Promise<void>;
}

/**
 * Un bucle independiente por adaptador: ciclo → espera hasta completar `intervalMs` (desde el inicio
 * del ciclo). Al ser secuencial, un adaptador nunca solapa ciclos consigo mismo; si un ciclo dura más
 * que el intervalo, el siguiente empieza nada más acabar.
 */
export function startScheduler(adapters: readonly IngestAdapter[], deps: CycleDeps): Scheduler {
  const ids = new Set<string>();
  for (const a of adapters) {
    if (ids.has(a.id)) throw new Error(`id de adaptador duplicado: ${a.id}`);
    ids.add(a.id);
  }
  const ctl = new AbortController();
  const { clock, logger } = deps;

  const loop = async (adapter: IngestAdapter): Promise<void> => {
    while (!ctl.signal.aborted) {
      const started = clock.now();
      try {
        await runCycle(adapter, ctl.signal, deps);
      } catch (e) {
        // runCycle captura sus errores; esto es una red de seguridad para no matar el bucle.
        logger.error("error inesperado en el ciclo", {
          source: adapter.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await clock.sleep(Math.max(0, adapter.intervalMs - (clock.now() - started)), ctl.signal);
    }
  };

  const done = Promise.all(adapters.map(loop)).then(() => undefined);
  return {
    done,
    async stop() {
      ctl.abort();
      await done;
    },
  };
}
