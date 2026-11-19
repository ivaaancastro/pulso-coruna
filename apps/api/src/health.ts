import { LAYER_IDS, type LayerId } from "@pulso/schema";
import type { SourceHealthRow, SourceStatus } from "./db.js";

export interface SourceReport {
  id: string;
  /** Estado efectivo: el peor entre lo que anota la ingesta y lo que dice la edad de la última lectura. */
  status: SourceStatus;
  /** Estado tal cual lo grabó la ingesta. */
  reportedStatus: SourceStatus;
  intervalMs: number;
  lastSuccessAt: number | null;
  /** Edad de la última lectura correcta (ms); null si nunca la hubo. */
  ageMs: number | null;
  lastErrorAt: number | null;
  consecutiveFailures: number;
}

export interface LayerReport {
  lastDataAt: number | null;
  ageMs: number | null;
}

export interface HealthReport {
  v: 1;
  ts: number;
  /** `down` si la BD no responde; si no, el peor estado de las fuentes (sin fuentes = `ok`). */
  status: SourceStatus;
  db: { ok: boolean; latencyMs: number | null };
  sources: SourceReport[];
  /** Última lectura por capa: alimenta la etiqueta «sin datos desde hace X min». */
  layers: Record<LayerId, LayerReport>;
}

const RANK: Record<SourceStatus, number> = { ok: 0, degraded: 1, down: 2 };
const worst = (a: SourceStatus, b: SourceStatus): SourceStatus => (RANK[a] >= RANK[b] ? a : b);

/**
 * Estado efectivo de una fuente. Si la ingesta se para, `source_health` se queda en `ok` para siempre:
 * la edad de la última lectura lo corrige (`degraded` pasado `staleFactor × intervalo`, `down` a los `3×` de eso).
 */
export function effectiveStatus(
  row: SourceHealthRow,
  now: number,
  staleFactor: number,
): SourceStatus {
  if (row.lastSuccessAt === null) return row.status;
  const age = now - row.lastSuccessAt;
  const limit = staleFactor * row.intervalMs;
  if (age > 3 * limit) return "down";
  if (age > limit) return worst(row.status, "degraded");
  return row.status;
}

export interface HealthInput {
  now: number;
  staleFactor: number;
  db: { ok: boolean; latencyMs: number | null };
  sources: SourceHealthRow[];
  freshness: Partial<Record<LayerId, number>>;
}

export function buildHealth(i: HealthInput): HealthReport {
  const sources: SourceReport[] = i.sources.map((r) => ({
    id: r.sourceId,
    status: effectiveStatus(r, i.now, i.staleFactor),
    reportedStatus: r.status,
    intervalMs: r.intervalMs,
    lastSuccessAt: r.lastSuccessAt,
    ageMs: r.lastSuccessAt === null ? null : Math.max(0, i.now - r.lastSuccessAt),
    lastErrorAt: r.lastErrorAt,
    consecutiveFailures: r.consecutiveFailures,
  }));
  const layers = Object.fromEntries(
    LAYER_IDS.map((l) => {
      const at = i.freshness[l] ?? null;
      return [l, { lastDataAt: at, ageMs: at === null ? null : Math.max(0, i.now - at) }];
    }),
  ) as Record<LayerId, LayerReport>;
  const status: SourceStatus = i.db.ok
    ? sources.reduce<SourceStatus>((acc, s) => worst(acc, s.status), "ok")
    : "down";
  return { v: 1, ts: i.now, status, db: i.db, sources, layers };
}
