import { bicicorunaAdapter } from "@pulso/adapters/bicicoruna";
import {
  createScheduleEstimatesAdapter,
  scheduleEstimatesConfigFromEnv,
  scheduleEstimatesEnabled,
} from "@pulso/adapters/gtfs";
import { createItranviasAdapter, itranviasConfigFromEnv } from "@pulso/adapters/itranvias";
import { meteogaliciaAdapter } from "@pulso/adapters/meteogalicia";
import { createOpenskyAdapter, openskyConfigFromEnv } from "@pulso/adapters/opensky";
import type { IngestAdapter } from "./types.js";

/**
 * Único punto de cableado de adaptadores reales. `id` debe ser único: es la clave de `source_health`.
 *
 * - GTFS (M3.1) no es una fuente en sí (feed estático, `GtfsFeed`), pero alimenta `bus-schedule`
 *   (M4.3a): posiciones de bus ESTIMADAS por horario (ids `sched:*`, `meta.estimated = 1`),
 *   activa por defecto; se apaga con `SCHEDULE_ESTIMATES_ENABLED=false`.
 * - iTranvías solo se registra con `ITRANVIAS_ENABLED=true` (permiso del operador sin confirmar).
 * - OpenSky (M5.1d, aviones) solo con `OPENSKY_ENABLED=true`; intervalo `OPENSKY_INTERVAL_MS`
 *   (defecto 5 min; cuota anónima 400/día). Credenciales OAuth2 opcionales, solo servidor.
 */
export function buildAdapters(env: Record<string, string | undefined>): IngestAdapter[] {
  const adapters: IngestAdapter[] = [bicicorunaAdapter, meteogaliciaAdapter];
  const itranvias = itranviasConfigFromEnv(env);
  if (itranvias.enabled) adapters.push(createItranviasAdapter(itranvias));
  const opensky = openskyConfigFromEnv(env);
  if (opensky.enabled) adapters.push(createOpenskyAdapter(opensky));
  if (scheduleEstimatesEnabled(env)) {
    adapters.push(createScheduleEstimatesAdapter(scheduleEstimatesConfigFromEnv(env)));
  }
  return adapters;
}

export const adapters: IngestAdapter[] = buildAdapters(process.env);
