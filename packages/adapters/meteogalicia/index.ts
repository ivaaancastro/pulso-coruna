import { ObservationSchema, type Adapter, type Observation } from "@pulso/schema";
import { httpGetJson } from "../common/http.js";

/**
 * MeteoGalicia: últimos datos 10-minutales de estaciones. Ver `docs/sources/meteogalicia.md`.
 * Atribución obligatoria: «Fonte dos datos: Xunta de Galicia» (https://abertos.xunta.gal).
 */
export const METEOGALICIA_BASE_URL =
  "https://servizos.meteogalicia.gal/mgrss/observacion/ultimos10minEstacionsMeteo.action";

/** 14000 Coruña-Dique y 14003 Punta Langosteira miden viento; 10157 Torre de Hércules solo T, HR y lluvia. */
export const DEFAULT_STATIONS = ["14000", "14003", "10157"] as const;

/** Un dato nuevo cada 10 min; sondear cada 5 basta (la fuente publica con 5–9 min de retraso). */
export const INTERVAL_MS = 5 * 60_000;

interface MetricSpec {
  metric: string;
  unit: string;
  /** Rango físico plausible; fuera de él se descarta. */
  min: number;
  max: number;
}

/** `codigoParametro` de la fuente → métrica normalizada. */
export const PARAMETERS: Readonly<Record<string, MetricSpec>> = {
  VV_AVG_10m: { metric: "wind_speed", unit: "m/s", min: 0, max: 100 },
  DV_AVG_10m: { metric: "wind_dir", unit: "deg", min: 0, max: 360 },
  VV_RACHA_10m: { metric: "wind_gust", unit: "m/s", min: 0, max: 120 },
  "TA_AVG_1.5m": { metric: "temperature", unit: "degC", min: -60, max: 60 },
  "HR_AVG_1.5m": { metric: "humidity", unit: "%", min: 0, max: 100 },
  // 1 L/m2 equivale a 1 mm de agua.
  "PP_SUM_1.5m": { metric: "rain_10m", unit: "mm", min: 0, max: 500 },
};

/** `lnCodigoValidacion` aceptados: 0 sin validar, 1 válido, 5 interpolado. Se descartan 2 (sospechoso), 3 (erróneo), 9 (no registrado). */
const ACCEPTED_VALIDATION = new Set([0, 1, 5]);

/** Valores centinela habituales de redes meteorológicas (-9999, -999…). */
const isSentinel = (v: number): boolean => v <= -999;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `2026-11-18T11:30:00` viene en UTC sin sufijo `Z`. */
function parseUtcInstant(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const ts = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ts) ? ts : null;
}

/** Puro: respuesta JSON de la fuente → observaciones válidas. Lo ilegible se descarta sin lanzar. */
export function parse(raw: unknown): Observation[] {
  if (!isRecord(raw) || !Array.isArray(raw["listUltimos10min"])) return [];
  const out: Observation[] = [];
  for (const station of raw["listUltimos10min"] as unknown[]) {
    if (!isRecord(station)) continue;
    const id = station["idEstacion"];
    const ts = parseUtcInstant(station["instanteLecturaUTC"]);
    const measures = station["listaMedidas"];
    if ((typeof id !== "number" && typeof id !== "string") || ts === null) continue;
    if (!Array.isArray(measures)) continue;
    for (const m of measures as unknown[]) {
      if (!isRecord(m)) continue;
      const code = m["codigoParametro"];
      const spec = typeof code === "string" ? PARAMETERS[code] : undefined;
      const value = m["valor"];
      if (!spec || typeof value !== "number" || !Number.isFinite(value) || isSentinel(value)) {
        continue;
      }
      if (value < spec.min || value > spec.max) continue;
      const validation = m["lnCodigoValidacion"];
      if (typeof validation === "number" && !ACCEPTED_VALIDATION.has(validation)) continue;
      const obs = ObservationSchema.safeParse({
        stationId: String(id),
        layer: "weather",
        metric: spec.metric,
        value,
        unit: spec.unit,
        ts,
      });
      if (obs.success) out.push(obs.data);
    }
  }
  return out;
}

export interface MeteoGaliciaOptions {
  /** Ids de estación. Por defecto 14000, 14003 y 10157. */
  stations?: readonly string[];
  baseUrl?: string;
  intervalMs?: number;
}

/** URL de una única petición para todas las estaciones. */
export function buildUrl(stations: readonly string[], baseUrl = METEOGALICIA_BASE_URL): string {
  return `${baseUrl}?idEst=${stations.map(encodeURIComponent).join(",")}`;
}

export function createMeteoGaliciaAdapter({
  stations = DEFAULT_STATIONS,
  baseUrl,
  intervalMs = INTERVAL_MS,
}: MeteoGaliciaOptions = {}): Adapter<Observation> {
  const url = buildUrl(stations, baseUrl);
  return {
    id: "meteogalicia",
    intervalMs,
    fetch: (signal) => httpGetJson(url, signal),
    parse,
  };
}

export const meteogaliciaAdapter = createMeteoGaliciaAdapter();
