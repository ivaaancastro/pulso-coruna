import { DISPLAY_TZ } from "./format";

/**
 * Días de calendario de Europe/Madrid como intervalos UTC. Un día local dura 23, 24 o 25 h (cambio
 * de hora), así que nunca se suman 86 400 000 ms a ciegas: se pregunta a `Intl`.
 */
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function localParts(epochMs: number): LocalParts {
  const out: Record<string, number> = {};
  for (const p of parts.formatToParts(epochMs)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    y: out["year"] ?? 0,
    m: out["month"] ?? 1,
    d: out["day"] ?? 1,
    h: out["hour"] ?? 0,
    mi: out["minute"] ?? 0,
    s: out["second"] ?? 0,
  };
}

/** Desfase de Madrid respecto de UTC (ms) en un instante: positivo al este. */
function offsetAt(epochMs: number): number {
  const p = localParts(epochMs);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Instante UTC de la medianoche local (Madrid) del día calendario `y-m-d`. */
function localMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d);
  // La medianoche cae antes de cualquier cambio de hora (02:00/03:00): dos pasadas bastan.
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return guess;
}

/** Inicio (UTC epoch ms) del día de Madrid que contiene `epochMs`. */
export function madridDayStart(epochMs: number): number {
  const p = localParts(epochMs);
  return localMidnight(p.y, p.m, p.d);
}

/** Inicio del día de Madrid `days` días después (o antes, si es negativo) del que empieza en `start`. */
export function addMadridDays(start: number, days: number): number {
  // Mediodía local: lejos de cualquier cambio de hora, así sumar días de calendario es seguro.
  const p = localParts(start + 12 * 3_600_000);
  return localMidnight(p.y, p.m, p.d + days);
}

/** Final (exclusivo) del día que empieza en `start`: el inicio del siguiente. */
export function madridDayEnd(start: number): number {
  return addMadridDays(start, 1);
}

/** Los `count` últimos días de Madrid (el primero es el de `nowMs`), del más reciente al más antiguo. */
export function recentDays(nowMs: number, count: number): number[] {
  const today = madridDayStart(nowMs);
  return Array.from({ length: count }, (_, i) => addMadridDays(today, -i));
}
