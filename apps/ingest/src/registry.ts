import type { IngestAdapter } from "./types.js";

/**
 * Único punto de cableado de adaptadores reales (M3.1–M3.4, M5.1…). Para añadir uno:
 *
 *   import { bicicorunaAdapter } from "@pulso/adapters/bicicoruna";
 *   export const adapters: IngestAdapter[] = [bicicorunaAdapter];
 *
 * `id` debe ser único: es la clave de `source_health`.
 */
export const adapters: IngestAdapter[] = [];
