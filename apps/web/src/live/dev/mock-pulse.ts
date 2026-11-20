import { fleetActivity, MOCK_RETENTION_DAYS } from "./mock-replay";

/**
 * Índice Pulso simulado SOLO PARA DESARROLLO: sirve `GET /api/v1/pulse` (formato de
 * `docs/specs/M7.2-indice-pulso.md`) como función pura del tiempo, con la misma curva diaria que la
 * flota de `mock-replay.ts`. Lo usa únicamente el plugin de Vite; no entra en el bundle. Un test
 * valida la respuesta contra `PulseSchema`.
 */
export const MOCK_PULSE_PATH = "/api/v1/pulse";

const MIN = 60_000;
const DAY_MS = 86_400_000;
const WINDOW_MAX = 24 * 3_600_000;

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "numeric",
  hourCycle: "h23",
});
const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Índice simulado (0–100, 1 decimal) del tramo que empieza en `ts`. */
export function mockPulseValue(ts: number): number {
  const hour = Number(hourFmt.format(ts));
  const wobble = 3 * Math.sin((2 * Math.PI * ts) / (47 * MIN)) + 2 * Math.sin(ts / (13 * MIN));
  return round1(Math.min(100, Math.max(0, 8 + 62 * fleetActivity(hour) + wobble)));
}

export interface MockPulseOptions {
  /** Ahora (epoch ms). */
  now: number;
}

export interface MockPulseResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export function handleMockPulse(
  search: URLSearchParams,
  opts: MockPulseOptions,
): MockPulseResponse {
  const bad = (message: string): MockPulseResponse => ({
    status: 400,
    headers: { "Cache-Control": "no-store" },
    body: { error: "bad_request", message },
  });
  const int = (v: string | null): number | null =>
    v !== null && /^\d+$/.test(v) ? Number(v) : null;
  const from = int(search.get("from"));
  const to = int(search.get("to"));
  const stepRaw = search.get("step");
  const step = stepRaw === null ? 5 * MIN : int(stepRaw);
  if (from === null || to === null || from <= 1e11 || to <= 1e11) {
    return bad("from y to deben ser epoch ms (enteros)");
  }
  if (step === null || step % MIN !== 0 || step < MIN || step > 60 * MIN) {
    return bad("step: múltiplo de 60000 entre 60000 y 3600000");
  }
  if (to <= from || to - from > WINDOW_MAX) return bad("0 < to − from ≤ 24 h");
  if (from > opts.now) return bad("from está en el futuro");
  if (from < opts.now - MOCK_RETENTION_DAYS * DAY_MS) return bad("from fuera de la retención");
  const points: { ts: number; value: number; layers: Record<string, number> }[] = [];
  for (let ts = from; ts < to && ts <= opts.now; ts += step) {
    const value = mockPulseValue(ts);
    points.push({
      ts,
      value,
      layers: {
        bus: round2(Math.min(3, (value / 50) * 1.1)),
        bike: round2(Math.min(3, value / 55)),
      },
    });
  }
  return {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
    body: { v: 1, from, to, stepMs: step, profile: "fixed", points },
  };
}
