/**
 * Lectura eficiente de horarios (calendar, calendar_dates, trips, stop_times) para la simulación
 * por horario (M3.4, plan B). Funciones puras; las fechas son `YYYYMMDD` (día de servicio local)
 * y las horas, segundos desde el inicio del día de servicio (pueden superar 86 400: «25:10:00»).
 */
import { csvRecords, csvRows } from "./csv.js";
import type { GtfsFiles } from "./static.js";

/** «HH:MM:SS» → segundos. Admite horas ≥ 24 (viajes que cruzan la medianoche). `null` si es inválida. */
export function parseGtfsTime(text: string | undefined): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d):([0-5]\d)\s*$/.exec(text ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export interface ServiceRule {
  /** Lunes…domingo. */
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  start: string;
  end: string;
}
export type ServiceCalendar = Map<string, ServiceRule>;

const DAY_COLUMNS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function readCalendar(text: string | undefined): ServiceCalendar {
  const out: ServiceCalendar = new Map();
  for (const r of csvRecords(text ?? "")) {
    const id = r["service_id"]?.trim();
    const start = r["start_date"]?.trim();
    const end = r["end_date"]?.trim();
    if (!id || !start || !end || !/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) continue;
    const days = DAY_COLUMNS.map((c) => r[c]?.trim() === "1") as ServiceRule["days"];
    out.set(id, { days, start, end });
  }
  return out;
}

export interface DateExceptions {
  added: Set<string>;
  removed: Set<string>;
}

/**
 * Excepciones por fecha. `dates` limita qué fechas se retienen (el archivo real tiene ~388 000
 * filas; para simular un día basta con una).
 */
export function readCalendarDates(
  text: string | undefined,
  dates?: ReadonlySet<string>,
): Map<string, DateExceptions> {
  const out = new Map<string, DateExceptions>();
  for (const r of csvRecords(text ?? "")) {
    const id = r["service_id"]?.trim();
    const date = r["date"]?.trim();
    const type = r["exception_type"]?.trim();
    if (!id || !date || (type !== "1" && type !== "2")) continue;
    if (dates && !dates.has(date)) continue;
    let ex = out.get(date);
    if (!ex) out.set(date, (ex = { added: new Set(), removed: new Set() }));
    (type === "1" ? ex.added : ex.removed).add(id);
  }
  return out;
}

/** Servicios activos un día: regla semanal dentro del rango, menos bajas, más altas. */
export function activeServiceIds(
  calendar: ServiceCalendar,
  exceptions: ReadonlyMap<string, DateExceptions>,
  date: string,
): Set<string> {
  const weekday =
    (new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))).getUTCDay() +
      6) %
    7;
  const active = new Set<string>();
  for (const [id, rule] of calendar) {
    if (date >= rule.start && date <= rule.end && rule.days[weekday]) active.add(id);
  }
  const ex = exceptions.get(date);
  if (ex) {
    for (const id of ex.removed) active.delete(id);
    for (const id of ex.added) active.add(id);
  }
  return active;
}

export interface Trip {
  tripId: string;
  routeId: string;
  serviceId: string;
  headsign?: string;
  directionId?: 0 | 1;
  shapeId?: string;
}

export function readTrips(
  text: string | undefined,
  filter?: (t: Trip) => boolean,
): Map<string, Trip> {
  const out = new Map<string, Trip>();
  for (const r of csvRecords(text ?? "")) {
    const tripId = r["trip_id"]?.trim();
    const routeId = r["route_id"]?.trim();
    const serviceId = r["service_id"]?.trim();
    if (!tripId || !routeId || !serviceId) continue;
    const trip: Trip = { tripId, routeId, serviceId };
    const headsign = r["trip_headsign"]?.trim();
    if (headsign) trip.headsign = headsign;
    const dir = r["direction_id"]?.trim();
    if (dir === "0" || dir === "1") trip.directionId = dir === "0" ? 0 : 1;
    const shapeId = r["shape_id"]?.trim();
    if (shapeId) trip.shapeId = shapeId;
    if (!filter || filter(trip)) out.set(tripId, trip);
  }
  return out;
}

/** Paradas de un viaje en orden de `stop_sequence`; las tres listas tienen la misma longitud. */
export interface TripStopTimes {
  stopIds: string[];
  /** Segundos desde el inicio del día de servicio. */
  arrivals: number[];
  departures: number[];
}

/**
 * Agrupa `stop_times` por viaje (≈358 000 filas en el feed real; una sola pasada). `tripIds`
 * descarta el resto sin reservar memoria. Filas sin stop_id/trip_id o sin ninguna hora válida se
 * ignoran; si falta una de las dos horas se usa la otra.
 */
export function readStopTimes(
  text: string | undefined,
  tripIds?: ReadonlySet<string>,
): Map<string, TripStopTimes> {
  const raw = new Map<string, { seq: number[]; t: TripStopTimes }>();
  let header: string[] | null = null;
  let iTrip = -1;
  let iArr = -1;
  let iDep = -1;
  let iStop = -1;
  let iSeq = -1;
  for (const row of csvRows(text ?? "")) {
    if (!header) {
      header = row.map((h) => h.trim());
      iTrip = header.indexOf("trip_id");
      iArr = header.indexOf("arrival_time");
      iDep = header.indexOf("departure_time");
      iStop = header.indexOf("stop_id");
      iSeq = header.indexOf("stop_sequence");
      if (iTrip < 0 || iStop < 0 || iSeq < 0) return new Map();
      continue;
    }
    const tripId = row[iTrip]?.trim();
    const stopId = row[iStop]?.trim();
    const seq = Number(row[iSeq]);
    if (!tripId || !stopId || !Number.isFinite(seq)) continue;
    if (tripIds && !tripIds.has(tripId)) continue;
    const arr = parseGtfsTime(iArr >= 0 ? row[iArr] : undefined);
    const dep = parseGtfsTime(iDep >= 0 ? row[iDep] : undefined);
    if (arr === null && dep === null) continue;
    let entry = raw.get(tripId);
    if (!entry)
      raw.set(tripId, (entry = { seq: [], t: { stopIds: [], arrivals: [], departures: [] } }));
    entry.seq.push(seq);
    entry.t.stopIds.push(stopId);
    entry.t.arrivals.push(arr ?? (dep as number));
    entry.t.departures.push(dep ?? (arr as number));
  }

  const out = new Map<string, TripStopTimes>();
  for (const [tripId, { seq, t }] of raw) {
    let sorted = true;
    for (let i = 1; i < seq.length; i++) {
      if ((seq[i] as number) < (seq[i - 1] as number)) {
        sorted = false;
        break;
      }
    }
    if (sorted) {
      out.set(tripId, t);
      continue;
    }
    const order = seq.map((_, i) => i).sort((a, b) => (seq[a] as number) - (seq[b] as number));
    out.set(tripId, {
      stopIds: order.map((i) => t.stopIds[i] as string),
      arrivals: order.map((i) => t.arrivals[i] as number),
      departures: order.map((i) => t.departures[i] as number),
    });
  }
  return out;
}

export interface DayTrip extends Trip {
  stops: TripStopTimes;
  /** Salida de la primera parada (s desde el inicio del día de servicio). */
  startSec: number;
  /** Llegada a la última parada. */
  endSec: number;
}

/**
 * Viajes que circulan un día de servicio (`YYYYMMDD`) con sus horas, ordenados por salida y
 * luego por `tripId` (determinista). Es la base de la simulación «horario» (M3.4 plan B).
 */
export function buildDaySchedule(files: GtfsFiles, date: string): DayTrip[] {
  const calendar = readCalendar(files["calendar.txt"]);
  const exceptions = readCalendarDates(files["calendar_dates.txt"], new Set([date]));
  const active = activeServiceIds(calendar, exceptions, date);
  const trips = readTrips(files["trips.txt"], (t) => active.has(t.serviceId));
  const times = readStopTimes(files["stop_times.txt"], new Set(trips.keys()));
  const out: DayTrip[] = [];
  for (const [tripId, trip] of trips) {
    const stops = times.get(tripId);
    if (!stops || stops.stopIds.length < 2) continue;
    out.push({
      ...trip,
      stops,
      startSec: stops.departures[0] as number,
      endSec: stops.arrivals[stops.arrivals.length - 1] as number,
    });
  }
  return out.sort((a, b) => a.startSec - b.startSec || (a.tripId < b.tripId ? -1 : 1));
}
