/**
 * Estimador de posiciones de bus a partir del horario GTFS (M4.3a). Función pura: dado el feed, sus
 * archivos de horario y un instante (epoch ms UTC), devuelve dónde DEBERÍA estar cada viaje en
 * circulación. Son posiciones ESTIMADAS (interpolación por horario), no reales: cada `Entity`
 * lleva `meta.estimated = 1` y `meta.source = "schedule"`. Ver `docs/specs/M4.3a-estimador-bus.md`.
 */
import type { Entity } from "@pulso/schema";
import { csvRecords } from "./csv.js";
import { buildDaySchedule, type DayTrip } from "./schedule.js";
import { buildFeed, type GtfsFeed, type GtfsFiles, type Position } from "./static.js";

/** Id de las entidades estimadas: `sched:<trip_id>`. Nunca colisiona con los ids reales de iTranvías. */
export const SCHEDULE_ID_PREFIX = "sched:";
export const SCHEDULE_TIME_ZONE = "Europe/Madrid";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- tiempo (Europe/Madrid)

const madridFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHEDULE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Desfase (ms) de Europe/Madrid respecto a UTC en un instante: +1 h invierno, +2 h verano. */
function madridOffsetMs(utcMs: number): number {
  const t = Math.floor(utcMs / 1000) * 1000;
  const p: Record<string, number> = {};
  for (const part of madridFormat.formatToParts(new Date(t))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    p["year"] as number,
    (p["month"] as number) - 1,
    p["day"] as number,
    p["hour"] as number,
    p["minute"] as number,
    p["second"] as number,
  );
  return asUtc - t;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dateUtc = (date: string): number =>
  Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8));

/** Día (`YYYYMMDD`) en Europe/Madrid de un instante UTC. */
export function madridDate(utcMs: number): string {
  return ymd(new Date(utcMs + madridOffsetMs(utcMs)));
}

/** Día anterior (`YYYYMMDD`). */
export function previousDate(date: string): string {
  return ymd(new Date(dateUtc(date) - DAY_MS));
}

/**
 * Inicio (epoch ms UTC) del día de servicio GTFS: «mediodía local menos 12 h» (definición de la
 * especificación, correcta también en los días de cambio de hora, que duran 23 o 25 h).
 */
export function serviceDayStartMs(date: string): number {
  const noonUtc = dateUtc(date) + 12 * 3_600_000;
  return noonUtc - madridOffsetMs(noonUtc) - 12 * 3_600_000;
}

// ---------------------------------------------------------------- geometría (plano local)

const REF_LAT = 43.37;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320 * Math.cos((REF_LAT * Math.PI) / 180);

type XY = readonly [x: number, y: number];
const toXY = ([lon, lat]: Position): XY => [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT];

/** Polilínea en metros con distancias acumuladas. */
interface Path {
  pts: XY[];
  /** `cum[i]` = metros desde el inicio hasta `pts[i]`. */
  cum: number[];
}

function makePath(coords: readonly Position[]): Path {
  const pts = coords.map(toXY);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as XY;
    const b = pts[i] as XY;
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { pts, cum };
}

/** Distancia acumulada del punto de la polilínea más cercano a `p`, buscando desde el tramo `from`. */
function project(path: Path, p: XY, from: number): { along: number; seg: number; d: number } {
  const last = path.pts.length - 1;
  if (from >= last) return { along: path.cum[last] as number, seg: from, d: Infinity };
  const at = (i: number): { d: number; along: number } => {
    const a = path.pts[i] as XY;
    const b = path.pts[i + 1] as XY;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return {
      d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)),
      along: (path.cum[i] as number) + t * Math.sqrt(len2),
    };
  };
  let best = Infinity;
  for (let i = from; i < last; i++) best = Math.min(best, at(i).d);
  // Trazados que pasan dos veces por el mismo sitio: entre los tramos casi igual de cercanos, el primero.
  for (let i = from; i < last; i++) {
    const c = at(i);
    if (c.d <= best + 25) return { ...c, seg: i };
  }
  return { along: path.cum[last] as number, seg: from, d: Infinity };
}

/** Punto y rumbo (0 = norte, grados) a `s` metros del inicio; el rumbo es el del tramo que sigue. */
function locate(path: Path, s: number): { pos: Position; heading: number } {
  const n = path.pts.length;
  const d = Math.max(0, Math.min(path.cum[n - 1] as number, s));
  let i = 0;
  while (i < n - 2 && (path.cum[i + 1] as number) <= d) i++;
  const a = path.pts[i] as XY;
  const b = path.pts[i + 1] as XY;
  const len = (path.cum[i + 1] as number) - (path.cum[i] as number);
  const t = len === 0 ? 0 : (d - (path.cum[i] as number)) / len;
  const heading = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return {
    pos: [(a[0] + t * (b[0] - a[0])) / M_PER_DEG_LON, (a[1] + t * (b[1] - a[1])) / M_PER_DEG_LAT],
    heading: (heading + 360) % 360,
  };
}

const round = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

// ---------------------------------------------------------------- estimador

/** Si alguna parada queda más lejos que esto del trazado, el trazado no es fiable: se usa la recta entre paradas. */
const MAX_STOP_OFF_SHAPE_M = 150;

/** Geometría de un viaje: recorrido en metros y distancia de cada parada sobre él. */
interface TripGeometry {
  path: Path;
  stopAlong: number[];
}

export interface BusEstimator {
  /** Fin de vigencia del feed (`YYYYMMDD`), `null` si no hay calendario válido. */
  validTo: string | null;
  /** Entidades bus estimadas en `nowMs` (epoch ms UTC), ordenadas por id. `[]` si el feed caducó. */
  estimate(nowMs: number): Entity[];
}

/**
 * Prepara un estimador. Conserva en memoria el horario de los días de servicio ya usados y la
 * geometría de cada viaje, así que llamarlo cada 15–30 s es barato.
 */
export function createBusEstimator(
  files: GtfsFiles,
  feed: GtfsFeed = buildFeed(files),
): BusEstimator {
  const stops = new Map(feed.stops.features.map((f) => [f.id, f]));
  const shapes = new Map(feed.shapes.features.map((f) => [f.id, f]));
  // De routes.txt (el feed GeoJSON omite las rutas sin trazado).
  const lines = new Map<string, string>();
  for (const r of csvRecords(files["routes.txt"] ?? "")) {
    const id = r["route_id"]?.trim();
    const name = r["route_short_name"]?.trim() || r["route_long_name"]?.trim();
    if (id && name) lines.set(id, name);
  }
  const validTo = feed.validity?.to ?? null;

  const days = new Map<string, DayTrip[]>();
  const dayTrips = (date: string): DayTrip[] => {
    let trips = days.get(date);
    if (!trips) {
      trips = buildDaySchedule(files, date);
      days.set(date, trips);
      // Solo hacen falta el día actual y el anterior (viajes que cruzan la medianoche).
      for (const old of [...days.keys()].sort().slice(0, -3)) days.delete(old);
    }
    return trips;
  };

  const geometries = new Map<string, TripGeometry | null>();
  const geometryOf = (trip: DayTrip): TripGeometry | null => {
    if (geometries.has(trip.tripId)) return geometries.get(trip.tripId) ?? null;
    let geo: TripGeometry | null = null;
    const coords: Position[] = [];
    for (const id of trip.stops.stopIds) {
      const f = stops.get(id);
      if (f) coords.push(f.geometry.coordinates);
    }
    if (coords.length === trip.stops.stopIds.length) {
      const shape = trip.shapeId ? shapes.get(trip.shapeId) : undefined;
      const shapePath = shape ? makePath(shape.geometry.coordinates) : null;
      if (shapePath && (shapePath.cum[shapePath.cum.length - 1] as number) > 0) {
        // Paradas proyectadas sobre el trazado, en orden (nunca retroceden).
        let seg = 0;
        let prev = 0;
        let worst = 0;
        const stopAlong = coords.map((c) => {
          const r = project(shapePath, toXY(c), seg);
          seg = r.seg;
          worst = Math.max(worst, r.d);
          prev = Math.max(prev, r.along);
          return prev;
        });
        if (worst <= MAX_STOP_OFF_SHAPE_M) geo = { path: shapePath, stopAlong };
      }
      if (!geo) {
        // Sin trazado: línea recta entre paradas.
        const path = makePath(coords);
        geo = { path, stopAlong: path.cum };
      }
    }
    geometries.set(trip.tripId, geo);
    return geo;
  };

  const place = (trip: DayTrip, secs: number, base: number, ts: number): Entity | null => {
    const geo = geometryOf(trip);
    if (!geo) return null;
    const { stopIds, arrivals, departures } = trip.stops;
    // Primera parada cuya salida no ha pasado aún.
    let i = 0;
    while (i < stopIds.length - 1 && secs > (departures[i] as number)) i++;
    let s = geo.stopAlong[i] as number;
    let speed = 0;
    if (i > 0 && secs < (arrivals[i] as number)) {
      // En marcha entre la parada i-1 y la i; si no, detenido en la parada i.
      const dep = departures[i - 1] as number;
      const arr = arrivals[i] as number;
      const a = geo.stopAlong[i - 1] as number;
      const b = s;
      const f = arr > dep ? (secs - dep) / (arr - dep) : 1;
      s = a + f * (b - a);
      speed = arr > dep ? (b - a) / (arr - dep) : 0;
    }
    const { pos, heading } = locate(geo.path, s);
    const meta: Record<string, string | number> = {
      source: "schedule",
      estimated: 1,
      tripId: trip.tripId,
      routeId: trip.routeId,
      line: lines.get(trip.routeId) ?? trip.routeId,
      nextStopId: stopIds[i] as string,
      nextStopTs: base + (arrivals[i] as number) * 1000,
    };
    if (trip.headsign) meta["headsign"] = trip.headsign;
    const nextName = stops.get(stopIds[i] as string)?.properties.name;
    if (nextName) meta["nextStop"] = nextName;
    return {
      id: `${SCHEDULE_ID_PREFIX}${trip.tripId}`,
      layer: "bus",
      lon: round(pos[0], 6),
      lat: round(pos[1], 6),
      heading: round(heading, 0) % 360,
      speed: round(Math.max(0, speed), 1),
      ts,
      meta,
    };
  };

  return {
    validTo,
    estimate(nowMs) {
      if (!Number.isFinite(nowMs) || validTo === null) return [];
      const today = madridDate(nowMs);
      const out = new Map<string, Entity>();
      for (const date of [today, previousDate(today)]) {
        // Servicio posterior al fin de vigencia (p. ej. altas sueltas en calendar_dates): caducado.
        if (date > validTo) continue;
        const base = serviceDayStartMs(date);
        const secs = (nowMs - base) / 1000;
        for (const trip of dayTrips(date)) {
          if (secs < trip.startSec || secs > trip.endSec) continue;
          const id = `${SCHEDULE_ID_PREFIX}${trip.tripId}`;
          if (out.has(id)) continue;
          const e = place(trip, secs, base, nowMs);
          if (e) out.set(id, e);
        }
      }
      return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
  };
}

/** Atajo de un solo uso (tests y scripts; en la ingesta se reutiliza el estimador). */
export function estimateBuses(files: GtfsFiles, nowMs: number): Entity[] {
  return createBusEstimator(files).estimate(nowMs);
}
