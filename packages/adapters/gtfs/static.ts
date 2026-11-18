/** GTFS estático → GeoJSON (rutas, paradas, trazados). Puro, sin red, salida determinista. */
import { csvRecords } from "./csv.js";

/** Archivos del zip ya como texto: nombre (`stops.txt`) → contenido. */
export type GtfsFiles = Readonly<Record<string, string | undefined>>;

/** A Coruña y su área (el feed real cae en lon -8.457…-8.379, lat 43.295…43.384). */
export const COVERAGE_BBOX = { minLon: -8.6, maxLon: -8.3, minLat: 43.25, maxLat: 43.45 } as const;

export type Position = [lon: number, lat: number];

export interface Feature<G, P> {
  type: "Feature";
  id: string;
  properties: P;
  geometry: G;
}
export interface FeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
}
export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}
export interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}
export interface MultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: Position[][];
}

export interface StopProperties {
  stopId: string;
  code?: string;
  name: string;
  description?: string;
}
export interface ShapeProperties {
  shapeId: string;
}
export interface RouteProperties {
  routeId: string;
  shortName: string;
  longName?: string;
  /** Trazados (`shape_id`) que componen la ruta, ordenados. */
  shapeIds: string[];
}

export interface GtfsFeed {
  routes: FeatureCollection<MultiLineStringGeometry, RouteProperties>;
  stops: FeatureCollection<PointGeometry, StopProperties>;
  shapes: FeatureCollection<LineStringGeometry, ShapeProperties>;
  /** Vigencia según `calendar.txt` (`YYYYMMDD`); `null` si no hay calendario válido. */
  validity: { from: string; to: string } | null;
  stats: {
    droppedStops: number;
    droppedShapePoints: number;
    droppedShapes: number;
    routesWithoutShape: number;
  };
}

/** 6 decimales (~0,1 m): salida compacta y estable. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Convierte y valida lat/lon; `null` si no son números finitos o caen fuera de la zona. */
export function parseCoordinate(lonText?: string, latText?: string): Position | null {
  if (!lonText?.trim() || !latText?.trim()) return null;
  const lon = Number(lonText);
  const lat = Number(latText);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const b = COVERAGE_BBOX;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) return null;
  return [round6(lon), round6(lat)];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isDate = (s: string | undefined): s is string => !!s && /^\d{8}$/.test(s);

/**
 * Construye la salida GeoJSON. Tolerante: filas sin id o con coordenadas inválidas se descartan
 * (y se cuentan en `stats`); un archivo ausente da una colección vacía. No lee `stop_times`.
 */
export function buildFeed(files: GtfsFiles): GtfsFeed {
  const stats = { droppedStops: 0, droppedShapePoints: 0, droppedShapes: 0, routesWithoutShape: 0 };

  const stopFeatures: Feature<PointGeometry, StopProperties>[] = [];
  const seenStops = new Set<string>();
  for (const r of csvRecords(files["stops.txt"] ?? "")) {
    const id = r["stop_id"]?.trim();
    const pos = parseCoordinate(r["stop_lon"], r["stop_lat"]);
    if (!id || !pos || seenStops.has(id)) {
      stats.droppedStops++;
      continue;
    }
    seenStops.add(id);
    const properties: StopProperties = { stopId: id, name: r["stop_name"]?.trim() || id };
    const code = r["stop_code"]?.trim();
    if (code) properties.code = code;
    const desc = r["stop_desc"]?.trim();
    if (desc) properties.description = desc;
    stopFeatures.push({
      type: "Feature",
      id,
      properties,
      geometry: { type: "Point", coordinates: pos },
    });
  }

  // Trazados: puntos por shape_id ordenados por shape_pt_sequence.
  const points = new Map<string, { seq: number; pos: Position }[]>();
  for (const r of csvRecords(files["shapes.txt"] ?? "")) {
    const id = r["shape_id"]?.trim();
    const seq = Number(r["shape_pt_sequence"]);
    if (!id || !Number.isFinite(seq)) {
      stats.droppedShapePoints++;
      continue;
    }
    const pos = parseCoordinate(r["shape_pt_lon"], r["shape_pt_lat"]);
    if (!pos) {
      stats.droppedShapePoints++;
      continue;
    }
    let list = points.get(id);
    if (!list) points.set(id, (list = []));
    list.push({ seq, pos });
  }
  const shapeFeatures: Feature<LineStringGeometry, ShapeProperties>[] = [];
  for (const [id, list] of points) {
    if (list.length < 2) {
      stats.droppedShapes++;
      continue;
    }
    list.sort((a, b) => a.seq - b.seq);
    shapeFeatures.push({
      type: "Feature",
      id,
      properties: { shapeId: id },
      geometry: { type: "LineString", coordinates: list.map((p) => p.pos) },
    });
  }
  shapeFeatures.sort(byId);
  const shapeById = new Map(shapeFeatures.map((f) => [f.id, f]));

  // Qué trazados usa cada ruta (vía trips.txt).
  const shapesOfRoute = new Map<string, Set<string>>();
  for (const t of csvRecords(files["trips.txt"] ?? "")) {
    const routeId = t["route_id"]?.trim();
    const shapeId = t["shape_id"]?.trim();
    if (!routeId || !shapeId || !shapeById.has(shapeId)) continue;
    let set = shapesOfRoute.get(routeId);
    if (!set) shapesOfRoute.set(routeId, (set = new Set()));
    set.add(shapeId);
  }

  const routeFeatures: Feature<MultiLineStringGeometry, RouteProperties>[] = [];
  const seenRoutes = new Set<string>();
  for (const r of csvRecords(files["routes.txt"] ?? "")) {
    const id = r["route_id"]?.trim();
    if (!id || seenRoutes.has(id)) continue;
    seenRoutes.add(id);
    const shapeIds = [...(shapesOfRoute.get(id) ?? [])].sort();
    if (shapeIds.length === 0) {
      stats.routesWithoutShape++;
      continue;
    }
    const properties: RouteProperties = {
      routeId: id,
      shortName: r["route_short_name"]?.trim() || r["route_long_name"]?.trim() || id,
      shapeIds,
    };
    const longName = r["route_long_name"]?.trim();
    if (longName) properties.longName = longName;
    routeFeatures.push({
      type: "Feature",
      id,
      properties,
      geometry: {
        type: "MultiLineString",
        coordinates: shapeIds.map((s) => shapeById.get(s)?.geometry.coordinates ?? []),
      },
    });
  }

  let from: string | null = null;
  let to: string | null = null;
  for (const c of csvRecords(files["calendar.txt"] ?? "")) {
    const s = c["start_date"];
    const e = c["end_date"];
    if (!isDate(s) || !isDate(e)) continue;
    if (from === null || s < from) from = s;
    if (to === null || e > to) to = e;
  }

  stopFeatures.sort(byId);
  routeFeatures.sort(byId);
  return {
    routes: { type: "FeatureCollection", features: routeFeatures },
    stops: { type: "FeatureCollection", features: stopFeatures },
    shapes: { type: "FeatureCollection", features: shapeFeatures },
    validity: from !== null && to !== null ? { from, to } : null,
    stats,
  };
}

/**
 * Días que faltan para el fin de vigencia (`YYYYMMDD`, día de servicio local) contados en días UTC;
 * negativo si ya caducó. Precisión de ±1 día: basta para avisar de que hay que renovar el feed.
 */
export function daysUntilExpiry(validTo: string, nowMs: number): number {
  const end = Date.UTC(+validTo.slice(0, 4), +validTo.slice(4, 6) - 1, +validTo.slice(6, 8));
  return Math.floor((end - nowMs) / 86_400_000);
}
