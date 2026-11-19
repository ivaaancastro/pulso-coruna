import { aisstreamConfigFromEnv, createAisstreamAdapter } from "@pulso/adapters/aisstream";
import { bicicorunaAdapter } from "@pulso/adapters/bicicoruna";
import {
  createScheduleEstimatesAdapter,
  scheduleEstimatesConfigFromEnv,
  scheduleEstimatesEnabled,
} from "@pulso/adapters/gtfs";
import { createItranviasAdapter, itranviasConfigFromEnv } from "@pulso/adapters/itranvias";
import { meteogaliciaAdapter } from "@pulso/adapters/meteogalicia";
import { consoleLogger, silentLogger } from "./clock.js";
import type { IngestAdapter, Logger } from "./types.js";

/**
 * Único punto de cableado de adaptadores reales. `id` debe ser único: es la clave de `source_health`.
 *
 * - GTFS (M3.1) no es una fuente en sí (feed estático, `GtfsFeed`), pero alimenta `bus-schedule`
 *   (M4.3a): posiciones de bus ESTIMADAS por horario (ids `sched:*`, `meta.estimated = 1`),
 *   activa por defecto; se apaga con `SCHEDULE_ESTIMATES_ENABLED=false`.
 * - iTranvías solo se registra con `ITRANVIAS_ENABLED=true` (permiso del operador sin confirmar).
 * - Barcos (aisstream, M5.1c) solo con `AISSTREAM_API_KEY` y `SHIP_ID_SALT`; sin ellas se avisa y se omite.
 */
export function buildAdapters(
  env: Record<string, string | undefined>,
  logger: Logger = silentLogger,
): IngestAdapter[] {
  const adapters: IngestAdapter[] = [bicicorunaAdapter, meteogaliciaAdapter];
  const itranvias = itranviasConfigFromEnv(env);
  if (itranvias.enabled) adapters.push(createItranviasAdapter(itranvias));
  if (scheduleEstimatesEnabled(env)) {
    adapters.push(createScheduleEstimatesAdapter(scheduleEstimatesConfigFromEnv(env)));
  }
  const ais = aisstreamConfigFromEnv(env);
  if (ais.enabled && ais.apiKey && ais.idSalt) {
    adapters.push(createAisstreamAdapter({ apiKey: ais.apiKey, idSalt: ais.idSalt, logger }));
  } else {
    logger.warn("barcos (aisstream) desactivados", { reason: ais.reason });
  }
  return adapters;
}

export const adapters: IngestAdapter[] = buildAdapters(process.env, consoleLogger);
