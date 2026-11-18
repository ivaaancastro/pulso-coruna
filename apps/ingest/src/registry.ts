import { bicicorunaAdapter } from "@pulso/adapters/bicicoruna";
import { createItranviasAdapter, itranviasConfigFromEnv } from "@pulso/adapters/itranvias";
import { meteogaliciaAdapter } from "@pulso/adapters/meteogalicia";
import type { IngestAdapter } from "./types.js";

/**
 * Único punto de cableado de adaptadores reales. `id` debe ser único: es la clave de `source_health`.
 *
 * - GTFS (M3.1) no está aquí: es un feed estático (`GtfsFeed`), no filas de series temporales.
 *   Lo consumirá la API o la simulación «horario» (plan B de M3.4).
 * - iTranvías solo se registra con `ITRANVIAS_ENABLED=true` (permiso del operador sin confirmar).
 */
export function buildAdapters(env: Record<string, string | undefined>): IngestAdapter[] {
  const adapters: IngestAdapter[] = [bicicorunaAdapter, meteogaliciaAdapter];
  const itranvias = itranviasConfigFromEnv(env);
  if (itranvias.enabled) adapters.push(createItranviasAdapter(itranvias));
  return adapters;
}

export const adapters: IngestAdapter[] = buildAdapters(process.env);
