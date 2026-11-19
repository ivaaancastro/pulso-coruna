import { bicicorunaAdapter } from "@pulso/adapters/bicicoruna";
import {
  createScheduleEstimatesAdapter,
  scheduleEstimatesConfigFromEnv,
  scheduleEstimatesEnabled,
} from "@pulso/adapters/gtfs";
import { createItranviasAdapter, itranviasConfigFromEnv } from "@pulso/adapters/itranvias";
import { meteogaliciaAdapter } from "@pulso/adapters/meteogalicia";
import { openMeteoAirAdapter, openMeteoAirEnabled } from "@pulso/adapters/openmeteo-air";
import type { IngestAdapter } from "./types.js";

/**
 * Único punto de cableado de adaptadores reales. `id` debe ser único: es la clave de `source_health`.
 *
 * - GTFS (M3.1) no es una fuente en sí (feed estático, `GtfsFeed`), pero alimenta `bus-schedule`
 *   (M4.3a): posiciones de bus ESTIMADAS por horario (ids `sched:*`, `meta.estimated = 1`),
 *   activa por defecto; se apaga con `SCHEDULE_ESTIMATES_ENABLED=false`.
 * - Open-Meteo Air (M5.1b): aire MODELADO (CAMS), `stationId` `openmeteo:coruna:model`; activo por
 *   defecto, se apaga con `OPENMETEO_AIR_ENABLED=false`.
 * - iTranvías solo se registra con `ITRANVIAS_ENABLED=true` (permiso del operador sin confirmar).
 */
export function buildAdapters(env: Record<string, string | undefined>): IngestAdapter[] {
  const adapters: IngestAdapter[] = [bicicorunaAdapter, meteogaliciaAdapter];
  if (openMeteoAirEnabled(env)) adapters.push(openMeteoAirAdapter);
  const itranvias = itranviasConfigFromEnv(env);
  if (itranvias.enabled) adapters.push(createItranviasAdapter(itranvias));
  if (scheduleEstimatesEnabled(env)) {
    adapters.push(createScheduleEstimatesAdapter(scheduleEstimatesConfigFromEnv(env)));
  }
  return adapters;
}

export const adapters: IngestAdapter[] = buildAdapters(process.env);
