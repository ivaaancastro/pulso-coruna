import type { LayerId } from "@pulso/schema";
import type { ConnectionState, LayerFreshness } from "./types";

/**
 * Estado de una capa respecto a su fuente (M4.6). Modelo puro: sin DOM, sin red, sin reloj propio.
 * - `live`: datos al día (o aún no sabemos nada: no se alarma antes del primer snapshot).
 * - `delayed`: el último dato es más viejo de lo habitual.
 * - `nodata`: la fuente lleva demasiado sin dar datos (o nunca dio).
 * - `disconnected`: lo que falla es nuestra conexión, no la fuente.
 */
export type SourceState = "live" | "delayed" | "nodata" | "disconnected";

export interface Thresholds {
  /** Edad del último dato a partir de la cual se considera retrasado, ms. */
  delayedMs: number;
  /** Edad a partir de la cual se considera sin datos, ms. */
  nodataMs: number;
}

const MIN = 60_000;

/**
 * Única tabla de umbrales. Ingesta (docs/specs/M3.5, M4.1): bus 20 s, bici 60 s, meteo 5 min; la
 * API marca `degraded` a 3× el intervalo y `down` a 9×. Las capas sin adaptador aún (M5.1) llevan
 * valores provisionales.
 */
export const SOURCE_THRESHOLDS: Readonly<Record<LayerId, Thresholds>> = {
  bus: { delayedMs: MIN, nodataMs: 2 * MIN },
  bike: { delayedMs: 3 * MIN, nodataMs: 5 * MIN },
  weather: { delayedMs: 15 * MIN, nodataMs: 30 * MIN },
  air: { delayedMs: 90 * MIN, nodataMs: 180 * MIN },
  sea: { delayedMs: 30 * MIN, nodataMs: 90 * MIN },
  ship: { delayedMs: 2 * MIN, nodataMs: 5 * MIN },
  plane: { delayedMs: MIN, nodataMs: 2 * MIN },
  train: { delayedMs: MIN, nodataMs: 2 * MIN },
};

/** Tiempo sin conexión antes de hablar de desconexión (microcortes y reconexiones rápidas no cuentan). */
export const DISCONNECT_GRACE_MS = 8000;

export interface ConnectionSnapshot {
  state: ConnectionState;
  /**
   * Cuánto lleva sin estar abierta, ms de reloj real (no el de la app, que en desarrollo puede estar
   * fijado con `?t=`); `0` si está abierta o aún no ha fallado.
   */
  downForMs: number;
}

export interface StatusInput {
  now: number;
  freshness: LayerFreshness | undefined;
  connection: ConnectionSnapshot;
  /** `layers.<capa>.lastDataAt` de `/api/v1/health`, solo para saber «desde cuándo». */
  healthLastDataAt?: number | null;
  thresholds: Thresholds;
}

export interface LayerStatus {
  state: SourceState;
  /** Última marca de dato conocida (epoch ms UTC), o `null` si nunca hubo. */
  lastDataAt: number | null;
}

export function isDisconnected(connection: ConnectionSnapshot): boolean {
  if (connection.state !== "reconnecting" && connection.state !== "closed") return false;
  return connection.downForMs >= DISCONNECT_GRACE_MS;
}

const valid = (ts: number | null | undefined): ts is number =>
  typeof ts === "number" && Number.isFinite(ts) && ts > 0;

export function layerStatus(input: StatusInput): LayerStatus {
  const { now, freshness, connection, thresholds } = input;
  const stored = freshness?.dataTs;
  const fromStore = valid(stored) ? stored : null;
  const health = input.healthLastDataAt;
  const lastDataAt = fromStore ?? (valid(health) ? health : null);

  // Antes del primer snapshot no sabemos nada: ni se atenúa ni se alarma.
  if (!freshness && lastDataAt === null) return { state: "live", lastDataAt: null };
  if (isDisconnected(connection)) return { state: "disconnected", lastDataAt };
  if (fromStore === null) return { state: "nodata", lastDataAt };

  const age = Math.max(0, now - fromStore);
  if (age >= thresholds.nodataMs) return { state: "nodata", lastDataAt };
  if (age >= thresholds.delayedMs) return { state: "delayed", lastDataAt };
  return { state: "live", lastDataAt };
}

const SEVERITY: Record<SourceState, number> = { live: 0, delayed: 1, disconnected: 2, nodata: 3 };

/** El peor de varios estados (una definición puede alimentarse de varias capas). */
export function worstState(states: readonly SourceState[]): SourceState {
  let worst: SourceState = "live";
  for (const s of states) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

/**
 * Factor de opacidad de una capa según su estado. `muted` es `--pulso-layer-muted-opacity`
 * (docs/design/tokens.md): `nodata` lo aplica entero; `delayed` y `disconnected` solo una parte.
 */
export function stateOpacity(state: SourceState, muted: number): number {
  const m = Math.min(1, Math.max(0, muted));
  switch (state) {
    case "live":
      return 1;
    case "delayed":
      return 1 - 0.3 * (1 - m);
    case "disconnected":
      return 1 - 0.6 * (1 - m);
    case "nodata":
      return m;
  }
}
