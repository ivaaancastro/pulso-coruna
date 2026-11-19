import { ObservationSchema, type Adapter, type Observation } from "@pulso/schema";
import { httpGetJson } from "../common/http.js";

/**
 * Open-Meteo Air Quality (modelo CAMS). Ver `docs/sources/calidade-aire.md` y
 * `docs/specs/M5.1b-adaptador-aire.md`.
 * Es un MODELO de rejilla, no una medición: el `stationId` lleva el sufijo `:model`.
 * Atribución obligatoria (CC BY 4.0): «Open-Meteo.com (datos CAMS)».
 */
export const OPENMETEO_AIR_BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

/** Centro de A Coruña; la fuente lo ajusta a su celda (43.4, -8.4). */
export const DEFAULT_POINT = { latitude: 43.3623, longitude: -8.4115 } as const;

/** Id sintético: el sufijo `:model` permite a la UI etiquetar «modelo». */
export const STATION_ID = "openmeteo:coruna:model";

/** El dato cambia cada hora; 15 min mantiene la petición < 100/día (límite: 10 000). */
export const INTERVAL_MS = 15 * 60_000;

/** Con micro sign (U+00B5); la fuente devuelve mu griega (U+03BC). */
const UG_M3 = "µg/m³";

interface MetricSpec {
  metric: string;
  unit: string;
  max: number;
}

/** Variable `current` de la fuente → métrica normalizada. */
export const VARIABLES: Readonly<Record<string, MetricSpec>> = {
  pm10: { metric: "pm10", unit: UG_M3, max: 1000 },
  pm2_5: { metric: "pm25", unit: UG_M3, max: 1000 },
  nitrogen_dioxide: { metric: "no2", unit: UG_M3, max: 1000 },
  ozone: { metric: "o3", unit: UG_M3, max: 1000 },
  sulphur_dioxide: { metric: "so2", unit: UG_M3, max: 1000 },
  european_aqi: { metric: "eaqi", unit: "EAQI", max: 500 },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `2026-11-19T14:00` sin sufijo: UTC porque la petición fuerza `timezone=GMT`. */
function parseUtcInstant(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const ts = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ts) ? ts : null;
}

/** Puro: respuesta JSON → observaciones de la hora actual. Lo ilegible se descarta sin lanzar. */
export function parse(raw: unknown): Observation[] {
  if (!isRecord(raw) || !isRecord(raw["current"])) return [];
  // Sin `timezone=GMT` la hora vendría en otra zona: no se asume, se descarta.
  if (raw["utc_offset_seconds"] !== 0) return [];
  const current = raw["current"];
  const ts = parseUtcInstant(current["time"]);
  if (ts === null) return [];
  const out: Observation[] = [];
  for (const [key, spec] of Object.entries(VARIABLES)) {
    const value = current[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < 0 || value > spec.max) continue;
    const obs = ObservationSchema.safeParse({
      stationId: STATION_ID,
      layer: "air",
      metric: spec.metric,
      value,
      unit: spec.unit,
      ts,
    });
    if (obs.success) out.push(obs.data);
  }
  return out;
}

export interface OpenMeteoAirOptions {
  latitude?: number;
  longitude?: number;
  baseUrl?: string;
  intervalMs?: number;
}

/** Una única petición, solo `current` (sin previsión), en GMT. */
export function buildUrl(
  { latitude, longitude }: { latitude: number; longitude: number } = DEFAULT_POINT,
  baseUrl = OPENMETEO_AIR_BASE_URL,
): string {
  const current = Object.keys(VARIABLES).join(",");
  return `${baseUrl}?latitude=${latitude}&longitude=${longitude}&current=${current}&timezone=GMT`;
}

export function createOpenMeteoAirAdapter({
  latitude = DEFAULT_POINT.latitude,
  longitude = DEFAULT_POINT.longitude,
  baseUrl,
  intervalMs = INTERVAL_MS,
}: OpenMeteoAirOptions = {}): Adapter<Observation> {
  const url = buildUrl({ latitude, longitude }, baseUrl);
  return {
    id: "openmeteo-air",
    intervalMs,
    fetch: (signal) => httpGetJson(url, signal),
    parse,
  };
}

/** Activo por defecto (sin clave, siempre disponible); se apaga con `OPENMETEO_AIR_ENABLED=false`. */
export function openMeteoAirEnabled(env: Record<string, string | undefined>): boolean {
  return env.OPENMETEO_AIR_ENABLED !== "false";
}

export const openMeteoAirAdapter = createOpenMeteoAirAdapter();
