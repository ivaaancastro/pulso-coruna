import type { Adapter, Entity, Observation, StationStatus } from "@pulso/schema";

/** Cualquier fila que puede producir un adaptador. */
export type Row = Entity | StationStatus | Observation;

/** Adaptador tal y como lo ve la ingesta (`Adapter<Entity>` etc. son asignables). */
export type IngestAdapter = Adapter<Row>;

/** Filas ya validadas, agrupadas por tabla de destino. */
export interface ValidRows {
  positions: Entity[];
  stations: StationStatus[];
  observations: Observation[];
}

export type HealthStatus = "ok" | "degraded" | "down";

/** Una fila de `source_health` (tiempos en epoch ms UTC). */
export interface SourceHealth {
  sourceId: string;
  status: HealthStatus;
  intervalMs: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  rowsWrittenLast: number;
  rowsWrittenTotal: number;
  rowsRejectedLast: number;
  updatedAt: number;
}

/** Persistencia que necesita el ciclo. Postgres en producción, memoria en tests. */
export interface Store {
  /** Inserta filas nuevas (idempotente por clave) y devuelve cuántas eran nuevas. */
  write(rows: ValidRows): Promise<number>;
  getHealth(sourceId: string): Promise<SourceHealth | null>;
  saveHealth(health: SourceHealth): Promise<void>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Reloj inyectable. `sleep` termina antes si `signal` se aborta (sin lanzar). */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
