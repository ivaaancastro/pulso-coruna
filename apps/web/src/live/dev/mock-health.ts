/**
 * `/api/v1/health` simulado SOLO PARA DESARROLLO (forma de `apps/api/src/health.ts`): lo sirve el plugin
 * de Vite junto al stream simulado, para ver el panel «Estado y créditos» (M8.4) sin API. Mezcla estados
 * a propósito (al día, retrasada, sin datos) y deja iTranvías sin registrar, como en producción hoy.
 * No entra en el bundle.
 */
export const MOCK_HEALTH_PATH = "/api/v1/health";

const MIN = 60_000;
const LAYERS = ["bus", "bike", "weather", "sea", "ship", "air", "plane", "train"] as const;

type Status = "ok" | "degraded" | "down";

interface MockSource {
  id: string;
  status: Status;
  intervalMs: number;
  /** Edad de la última lectura correcta, ms; `null` = nunca. */
  ageMs: number | null;
  failures: number;
}

const SOURCES: readonly MockSource[] = [
  { id: "bicicoruna", status: "ok", intervalMs: MIN, ageMs: 41_000, failures: 0 },
  { id: "bus-schedule", status: "ok", intervalMs: 20_000, ageMs: 12_000, failures: 0 },
  { id: "meteogalicia", status: "ok", intervalMs: 5 * MIN, ageMs: 2 * MIN, failures: 0 },
  { id: "portus", status: "degraded", intervalMs: 15 * MIN, ageMs: 52 * MIN, failures: 3 },
  { id: "openmeteo-air", status: "ok", intervalMs: 15 * MIN, ageMs: 7 * MIN, failures: 0 },
  { id: "aisstream", status: "ok", intervalMs: MIN, ageMs: 25_000, failures: 0 },
  { id: "opensky", status: "down", intervalMs: 5 * MIN, ageMs: 3 * 60 * MIN, failures: 12 },
];

export function handleMockHealth(opts: { now: number }): {
  status: number;
  headers: Record<string, string>;
  body: unknown;
} {
  const { now } = opts;
  const sources = SOURCES.map((s) => ({
    id: s.id,
    status: s.status,
    reportedStatus: s.status,
    intervalMs: s.intervalMs,
    lastSuccessAt: s.ageMs === null ? null : now - s.ageMs,
    ageMs: s.ageMs,
    lastErrorAt: s.failures > 0 ? now - 30_000 : null,
    consecutiveFailures: s.failures,
  }));
  const layers = Object.fromEntries(
    LAYERS.map((l) => [l, { lastDataAt: now - 15_000, ageMs: 15_000 }]),
  );
  return {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    body: { v: 1, ts: now, status: "down", db: { ok: true, latencyMs: 3 }, sources, layers },
  };
}
