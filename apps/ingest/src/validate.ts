import {
  EntitySchema,
  MOBILE_LAYER_IDS,
  OBSERVATION_LAYER_IDS,
  ObservationSchema,
  StationStatusSchema,
} from "@pulso/schema";
import type { ValidRows } from "./types.js";

const isMobile = (layer: unknown): boolean =>
  (MOBILE_LAYER_IDS as readonly unknown[]).includes(layer);
const isObservation = (layer: unknown): boolean =>
  (OBSERVATION_LAYER_IDS as readonly unknown[]).includes(layer);

export interface Validated {
  valid: ValidRows;
  /** Filas descartadas por no cumplir el contrato. */
  rejected: number;
  /** Primer motivo de rechazo, para el log. */
  firstError: string | null;
}

/** Valida cada fila con el esquema que corresponde a su capa (capa→tipo, ADR-0006). */
export function validateRows(rows: readonly unknown[]): Validated {
  const valid: ValidRows = { positions: [], stations: [], observations: [] };
  let rejected = 0;
  let firstError: string | null = null;
  const reject = (reason: string): void => {
    rejected++;
    firstError ??= reason;
  };
  for (const row of rows) {
    const layer =
      typeof row === "object" && row !== null ? (row as { layer?: unknown }).layer : undefined;
    if (isMobile(layer)) {
      const r = EntitySchema.safeParse(row);
      if (r.success) valid.positions.push(r.data);
      else reject(r.error.message);
    } else if (layer === "bike") {
      const r = StationStatusSchema.safeParse(row);
      if (r.success) valid.stations.push(r.data);
      else reject(r.error.message);
    } else if (isObservation(layer)) {
      const r = ObservationSchema.safeParse(row);
      if (r.success) valid.observations.push(r.data);
      else reject(r.error.message);
    } else {
      reject(`capa desconocida: ${String(layer)}`);
    }
  }
  return { valid, rejected, firstError };
}

export const countRows = (v: ValidRows): number =>
  v.positions.length + v.stations.length + v.observations.length;
