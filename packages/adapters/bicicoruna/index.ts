import { StationStatusSchema, type Adapter, type StationStatus } from "@pulso/schema";
import { httpGetJson } from "../common/http.js";

export const BICICORUNA_URL =
  "https://csc-api.coruna.eu/api-manager/server/api/v1/estaciones_bicicoruna/getAssets";

/** Lo que devuelve `fetch`: el cuerpo crudo y la hora de la petición (la fuente no trae hora del dato). */
export interface BicicorunaRaw {
  fetchedAt: number;
  body: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Entero >= 0 o undefined. */
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/**
 * Convierte el cuerpo de `getAssets` en `StationStatus[]` con `ts` dado. Puro.
 * Lanza si el cuerpo no es un array (formato cambiado); descarta estaciones inválidas
 * (sin id, coordenadas fuera de A Coruña, contadores ausentes o no enteros).
 * `status` distinto de `working` => `bikes` y `docks` a 0 (estación sin servicio).
 * `location.coordinates` viene como `[lat, lon]`, invertido respecto a GeoJSON.
 */
export function parseStations(body: unknown, ts: number): StationStatus[] {
  if (!Array.isArray(body)) throw new Error("BiciCoruña: se esperaba un array de estaciones");
  const out: StationStatus[] = [];
  for (const item of body) {
    if (!isRecord(item)) continue;
    const st = item["BikeHireDockingStation"];
    if (!isRecord(st)) continue;
    const loc = st["location"];
    const coords = isRecord(loc) ? loc["coordinates"] : undefined;
    if (!Array.isArray(coords)) continue;
    const [lat, lon] = coords as unknown[];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (lat < 43.3 || lat > 43.45 || lon < -8.6 || lon > -8.3) continue;
    const rawId = st["id"];
    const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
    const bikes = count(st["availableBikeNumber"]);
    const docks = count(st["freeSlotNumber"]);
    if (id === "" || bikes === undefined || docks === undefined) continue;
    const working = st["status"] === "working";
    const parsed = StationStatusSchema.safeParse({
      id,
      layer: "bike",
      lon,
      lat,
      bikes: working ? bikes : 0,
      docks: working ? docks : 0,
      ts,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export const bicicorunaAdapter: Adapter<StationStatus> = {
  id: "bicicoruna",
  intervalMs: 60_000,
  async fetch(signal) {
    const fetchedAt = Date.now();
    const body = await httpGetJson(BICICORUNA_URL, signal);
    return { fetchedAt, body } satisfies BicicorunaRaw;
  },
  parse(raw) {
    if (!isRecord(raw) || typeof raw["fetchedAt"] !== "number") {
      throw new Error("BiciCoruña: se esperaba { fetchedAt, body }");
    }
    return parseStations(raw["body"], raw["fetchedAt"]);
  },
};
