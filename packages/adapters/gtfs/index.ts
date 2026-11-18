/**
 * Adaptador GTFS de la Compañía de Tranvías de A Coruña (fuente estática; ver
 * `docs/sources/gtfs-tranvias.md`). `fetch` descarga y descomprime el zip; `parse` es puro y lo
 * convierte en GeoJSON. Las funciones de horario (`schedule.ts`) trabajan sobre los mismos archivos.
 */
import type { Adapter } from "@pulso/schema";
import { httpGet } from "../common/http.js";
import { buildFeed, type GtfsFeed, type GtfsFiles } from "./static.js";
import { unzip } from "./zip.js";

export * from "./static.js";
export * from "./schedule.js";
export { csvRecords, csvRows } from "./csv.js";
export { unzip } from "./zip.js";

export const GTFS_ADAPTER_ID = "gtfs-tranvias";
/** Espejo de Mobility Database (feed mdb-2767); origen oficial: NAP. Puede cambiar de URL. */
export const GTFS_URL = "https://files.mobilitydatabase.org/mdb-2767/latest.zip";
/** Atribución obligatoria (licencia aceptada con atribución a la fuente, decisión humana 2026-11-18). */
export const GTFS_ATTRIBUTION =
  "Datos GTFS de la Compañía de Tranvías de A Coruña, S.A., vía el Punto de Acceso Nacional de Transporte (MITMA) y Mobility Database.";

/** Archivos GTFS que interesan; el resto del zip no se descomprime. */
const WANTED = new Set([
  "agency.txt",
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "shapes.txt",
]);

/** Zip (bytes) → archivos de texto UTF-8 utilizables por `parse` y las funciones de horario. */
export async function readGtfsZip(bytes: Uint8Array): Promise<GtfsFiles> {
  const entries = await unzip(bytes, { filter: (name) => WANTED.has(name) });
  const decoder = new TextDecoder("utf-8");
  const files: Record<string, string> = {};
  for (const [name, data] of entries) files[name] = decoder.decode(data);
  return files;
}

function isFiles(raw: unknown): raw is GtfsFiles {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * Devuelve un único `GtfsFeed`, o `[]` si el zip no aportó ninguna parada, ruta ni trazado
 * válidos (zip vacío o ajeno al GTFS).
 */
export function parseGtfs(raw: unknown): GtfsFeed[] {
  if (!isFiles(raw)) return [];
  const feed = buildFeed(raw);
  const empty =
    feed.stops.features.length === 0 &&
    feed.routes.features.length === 0 &&
    feed.shapes.features.length === 0;
  return empty ? [] : [feed];
}

export const gtfsAdapter: Adapter<GtfsFeed> & { fetch(signal: AbortSignal): Promise<GtfsFiles> } = {
  id: GTFS_ADAPTER_ID,
  /** Feed estático: una descarga al día basta (vigencia de semanas). */
  intervalMs: 24 * 60 * 60 * 1000,
  async fetch(signal) {
    const res = await httpGet(GTFS_URL, signal, { timeoutMs: 60_000 });
    return readGtfsZip(new Uint8Array(await res.arrayBuffer()));
  },
  parse: parseGtfs,
};
