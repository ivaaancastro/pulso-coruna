import { ObservationSchema, type Adapter, type Observation } from "@pulso/schema";
import { USER_AGENT } from "../common/http.js";

/**
 * Portus (Puertos del Estado): nivel del mar del mareógrafo de A Coruña. Ver `docs/sources/portus.md`.
 * Atribución obligatoria a Puertos del Estado al mostrar. API interna de su web, sin garantías.
 */
export const PORTUS_BASE_URL = "https://portus.puertos.es/portussvr/api";

/** Mareógrafo asociado al puerto de A Coruña (12130). */
export const DEFAULT_STATION = "3219";

/** Una medición por minuto como mucho; con 5 min la marea queda bien muestreada. */
export const INTERVAL_MS = 5 * 60_000;

/** Rango físico plausible del nivel (m); fuera de él se descarta. */
const MIN_LEVEL = -5;
const MAX_LEVEL = 15;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `2026-11-19 14:56:00.0` viene en UTC, sin zona. */
export function parseUtcInstant(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = Number(m[6] ?? 0);
  const ts = Date.UTC(y, mo - 1, d, h, mi, sec);
  const back = new Date(ts);
  // Rechaza fechas desbordadas (31 de febrero, hora 25…).
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) {
    return null;
  }
  return Number.isFinite(ts) ? ts : null;
}

/** Puro: respuesta de `lastData/station` → observaciones válidas. Lo ilegible se descarta sin lanzar. */
export function parse(raw: unknown, station: string = DEFAULT_STATION): Observation[] {
  if (!isRecord(raw) || !Array.isArray(raw["datos"])) return [];
  const ts = parseUtcInstant(raw["fecha"]);
  if (ts === null) return [];
  const out: Observation[] = [];
  for (const d of raw["datos"] as unknown[]) {
    if (!isRecord(d) || d["variable"] !== "SEA_LEVEL") continue;
    if (d["averia"] === true || d["unidad"] !== "m") continue;
    const factor = d["factor"];
    const valor = typeof d["valor"] === "string" ? d["valor"].trim() : d["valor"];
    if (typeof factor !== "number" || !(factor > 0)) continue;
    if (valor === "" || (typeof valor !== "string" && typeof valor !== "number")) continue;
    const value = Number(valor) / factor;
    if (!Number.isFinite(value) || value <= -999 || value < MIN_LEVEL || value > MAX_LEVEL) {
      continue;
    }
    const obs = ObservationSchema.safeParse({
      stationId: `portus:${station}`,
      layer: "sea",
      metric: "tide_level",
      value: Math.round(value * 1e6) / 1e6,
      unit: "m",
      ts,
    });
    if (obs.success) out.push(obs.data);
  }
  return out;
}

export interface PortusOptions {
  /** Id del mareógrafo. Por defecto 3219 (A Coruña). */
  station?: string;
  baseUrl?: string;
  intervalMs?: number;
  /** Tiempo máximo por petición. */
  timeoutMs?: number;
}

export function buildUrl(station: string, baseUrl = PORTUS_BASE_URL): string {
  return `${baseUrl}/lastData/station/${encodeURIComponent(station)}?locale=es`;
}

export function createPortusAdapter({
  station = DEFAULT_STATION,
  baseUrl,
  intervalMs = INTERVAL_MS,
  timeoutMs = 15_000,
}: PortusOptions = {}): Adapter<Observation> {
  const url = buildUrl(station, baseUrl);
  return {
    id: "portus",
    intervalMs,
    fetch: async (signal) => {
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json" },
        body: JSON.stringify(["SEA_LEVEL"]),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return (await res.json()) as unknown;
    },
    parse: (raw) => parse(raw, station),
  };
}

/** `PORTUS_ENABLED=true` la activa (API interna sin garantías: apagada por defecto). */
export function portusEnabled(env: Record<string, string | undefined>): boolean {
  return env["PORTUS_ENABLED"] === "true";
}

export const portusAdapter = createPortusAdapter();
