import type { HealthStatus, SourceHealth } from "./types.js";

export interface CycleOutcome {
  sourceId: string;
  intervalMs: number;
  at: number;
  ok: boolean;
  latencyMs: number | null;
  rowsWritten: number;
  rowsRejected: number;
  error?: string;
}

export function statusFor(consecutiveFailures: number, downAfter: number): HealthStatus {
  if (consecutiveFailures === 0) return "ok";
  return consecutiveFailures >= downAfter ? "down" : "degraded";
}

/** Estado de `source_health` tras un ciclo. Puro: no toca BD ni reloj. */
export function nextHealth(
  prev: SourceHealth | null,
  outcome: CycleOutcome,
  downAfter: number,
): SourceHealth {
  const failures = outcome.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1;
  return {
    sourceId: outcome.sourceId,
    status: statusFor(failures, downAfter),
    intervalMs: outcome.intervalMs,
    lastSuccessAt: outcome.ok ? outcome.at : (prev?.lastSuccessAt ?? null),
    lastErrorAt: outcome.ok ? (prev?.lastErrorAt ?? null) : outcome.at,
    lastError: outcome.ok ? (prev?.lastError ?? null) : (outcome.error ?? "error desconocido"),
    consecutiveFailures: failures,
    lastLatencyMs: outcome.latencyMs ?? prev?.lastLatencyMs ?? null,
    rowsWrittenLast: outcome.rowsWritten,
    rowsWrittenTotal: (prev?.rowsWrittenTotal ?? 0) + outcome.rowsWritten,
    rowsRejectedLast: outcome.rowsRejected,
    updatedAt: outcome.at,
  };
}
