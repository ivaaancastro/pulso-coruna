/**
 * Fuente de ingesta «bus por horario» (M4.3a): estima posiciones de bus a partir del GTFS y las
 * emite como `Entity` de la capa `bus` (siempre marcadas como estimadas). El feed se descarga una
 * vez cada 24 h en segundo plano (no por ciclo), se conserva en memoria y, si la descarga falla, se
 * reintenta con espera creciente sin tocar la red en cada ciclo.
 */
import type { Adapter, Entity } from "@pulso/schema";
import { createBusEstimator, madridDate, type BusEstimator } from "./estimate.js";
import { gtfsAdapter } from "./index.js";
import { buildFeed, type GtfsFiles } from "./static.js";

export const SCHEDULE_ADAPTER_ID = "bus-schedule";
export const SCHEDULE_DEFAULT_INTERVAL_MS = 20_000;
export const SCHEDULE_MIN_INTERVAL_MS = 15_000;
const DAY_MS = 86_400_000;

export interface ScheduleEstimatesConfig {
  intervalMs?: number;
  /** Cada cuánto se vuelve a descargar el GTFS. Por defecto 24 h. */
  refreshMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Inyectables para tests (nunca se llama a la red real desde los tests). */
  load?: (signal: AbortSignal) => Promise<GtfsFiles>;
  now?: () => number;
}

/** `SCHEDULE_ESTIMATES_ENABLED`: activa salvo `false` / `0` / `off` (por defecto true). */
export function scheduleEstimatesEnabled(env: Record<string, string | undefined>): boolean {
  const v = env["SCHEDULE_ESTIMATES_ENABLED"]?.trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off");
}

/** `SCHEDULE_ESTIMATES_INTERVAL_MS`: opcional, nunca por debajo de 15 s. */
export function scheduleEstimatesConfigFromEnv(
  env: Record<string, string | undefined>,
): Pick<ScheduleEstimatesConfig, "intervalMs"> {
  const n = Number(env["SCHEDULE_ESTIMATES_INTERVAL_MS"]);
  return Number.isFinite(n) && n > 0 ? { intervalMs: n } : {};
}

interface Raw {
  now: number;
  estimator: BusEstimator;
}

export function createScheduleEstimatesAdapter(
  config: ScheduleEstimatesConfig = {},
): Adapter<Entity> {
  const now = config.now ?? Date.now;
  const load =
    config.load ?? ((signal: AbortSignal) => gtfsAdapter.fetch(signal) as Promise<GtfsFiles>);
  const refreshMs = config.refreshMs ?? DAY_MS;
  const retryBaseMs = config.retryBaseMs ?? 60_000;
  const retryMaxMs = config.retryMaxMs ?? 30 * 60_000;
  const intervalMs = Math.max(
    config.intervalMs ?? SCHEDULE_DEFAULT_INTERVAL_MS,
    SCHEDULE_MIN_INTERVAL_MS,
  );

  let model: { estimator: BusEstimator; loadedAt: number } | undefined;
  let inflight: Promise<void> | undefined;
  let failures = 0;
  let nextRetryAt = 0;
  let lastError = "";

  /** Lanza la descarga si toca. No depende de la señal del ciclo: su timeout (15 s) es menor que el de la descarga. */
  const refresh = (): void => {
    const t = now();
    const expired =
      model?.estimator.validTo != null &&
      model.estimator.validTo < madridDate(t) &&
      t - model.loadedAt > 60 * 60_000;
    const stale = !model || t - model.loadedAt >= refreshMs || expired;
    if (!stale || inflight || t < nextRetryAt) return;
    inflight = (async () => {
      try {
        const files = await load(new AbortController().signal);
        const feed = buildFeed(files);
        if (feed.stops.features.length === 0 || feed.validity === null) {
          throw new Error("GTFS sin paradas o sin calendario válidos");
        }
        model = { estimator: createBusEstimator(files, feed), loadedAt: now() };
        failures = 0;
        nextRetryAt = 0;
        lastError = "";
      } catch (e) {
        failures++;
        lastError = e instanceof Error ? e.message : String(e);
        nextRetryAt = now() + Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1));
      } finally {
        inflight = undefined;
      }
    })();
  };

  return {
    id: SCHEDULE_ADAPTER_ID,
    intervalMs,
    async fetch(signal): Promise<Raw> {
      refresh();
      if (!model && inflight) {
        const pending = inflight;
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          void pending.then(resolve);
        });
      }
      if (!model) {
        throw new Error(`GTFS no disponible: ${lastError || "descarga pendiente"}`);
      }
      const t = now();
      const { validTo } = model.estimator;
      if (validTo !== null && madridDate(t) > validTo) {
        throw new Error(`feed GTFS caducado (vigencia hasta ${validTo}); no se emite nada`);
      }
      return { now: t, estimator: model.estimator };
    },
    parse(raw): Entity[] {
      const r = raw as Raw;
      return r.estimator.estimate(r.now);
    },
  };
}
