import { worstState } from "../live/source-status";
import type { RowStatus, RowState } from "./credits";
import type { SourceInfo } from "./sources";

export interface SourceHealthEntry {
  status: "ok" | "degraded" | "down";
  /** Última lectura correcta (epoch ms UTC) o `null` si nunca la hubo. */
  lastSuccessAt: number | null;
}

export interface HealthReport {
  /** Reloj del servidor (epoch ms UTC): las edades se calculan contra él, no contra el del cliente. */
  ts: number;
  db: boolean;
  sources: ReadonlyMap<string, SourceHealthEntry>;
}

const STATUS = new Set(["ok", "degraded", "down"]);
const isStamp = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Lee `/api/v1/health` (también el cuerpo del 503). Tolerante: ignora lo mal formado; `null` si no es el informe. */
export function parseHealthReport(body: unknown): HealthReport | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { ts?: unknown; db?: unknown; sources?: unknown };
  if (!isStamp(raw.ts) || !Array.isArray(raw.sources)) return null;
  const sources = new Map<string, SourceHealthEntry>();
  for (const item of raw.sources as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, status, lastSuccessAt } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof status !== "string" || !STATUS.has(status)) continue;
    sources.set(id, {
      status: status as SourceHealthEntry["status"],
      lastSuccessAt: isStamp(lastSuccessAt) ? lastSuccessAt : null,
    });
  }
  const db = (raw.db as { ok?: unknown } | null | undefined)?.ok;
  return { ts: raw.ts, db: db !== false, sources };
}

const FROM_API: Record<SourceHealthEntry["status"], "live" | "delayed" | "nodata"> = {
  ok: "live",
  degraded: "delayed",
  down: "nodata",
};

/** Cruza el catálogo con el informe: una fila por fuente (mismo orden), con el peor estado de sus ids. */
export function deriveRows(infos: readonly SourceInfo[], report: HealthReport): RowStatus[] {
  return infos.map((info) => {
    if (info.healthIds.length === 0) return { state: "static", lastSuccessAt: null };
    const found = info.healthIds.flatMap((id) => {
      const entry = report.sources.get(id);
      return entry ? [entry] : [];
    });
    if (found.length === 0) return { state: "inactive", lastSuccessAt: null };
    const stamps = found.flatMap((e) => (e.lastSuccessAt === null ? [] : [e.lastSuccessAt]));
    return {
      state: worstState(found.map((e) => FROM_API[e.status])) as RowState,
      lastSuccessAt: stamps.length > 0 ? Math.max(...stamps) : null,
    };
  });
}
