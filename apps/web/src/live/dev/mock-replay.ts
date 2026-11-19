import type { LayerId, ReplayWindow } from "@pulso/schema";
import {
  ALVEDRO,
  AIR_STATION,
  HOUR_MS,
  KNOT,
  ROUTES,
  ROUTE_IDS,
  SHIP_ROUTES,
  SHIP_SPECS,
  STATIONS,
  WEATHER_STATIONS,
  mockTideLevel,
  offset,
  pointAt,
  routeGeometry,
} from "./mock-sim";

/**
 * Histórico simulado SOLO PARA DESARROLLO: genera ventanas `/api/v1/replay` (formato de
 * `docs/specs/M6.2-api-replay.md`) coherentes con el mundo de `mock-sim.ts` (mismas rutas,
 * estaciones, ids y marea), pero como función pura del tiempo: cualquier instante de los últimos
 * `MOCK_RETENTION_DAYS` días se puede pedir y es siempre el mismo. Lo usa únicamente el plugin de
 * Vite (`vite/mock-live-plugin.mjs`); no entra en el bundle. No importa valores de `@pulso/schema`
 * (el plugin lo carga Node sin transpilar workspaces): los conversores se repiten aquí y un test
 * valida el resultado contra `ReplayWindowSchema`.
 */
export const MOCK_REPLAY_PATH = "/api/v1/replay";
/** Días con histórico simulado; más atrás la ventana sale vacía (para probar «sin datos»). */
export const MOCK_RETENTION_DAYS = 14;

const WINDOW_MS = 300_000;
const DAY_MS = 86_400_000;
const COORD = 100_000;
const SPEED = 10;
const q = (deg: number): number => Math.round(deg * COORD);
const qs = (ms: number): number => Math.round(ms * SPEED);
const frac = (x: number): number => x - Math.floor(x);
const round1 = (x: number): number => Math.round(x * 10) / 10;

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "numeric",
  hourCycle: "h23",
});
const madridHour = (t: number): number => Number(hourFmt.format(t));

/** Fracción de la flota en servicio según la hora local: valle de madrugada, puntas de mañana y tarde. */
export function fleetActivity(hour: number): number {
  if (hour < 5) return 0.08;
  if (hour < 6) return 0.2;
  if (hour < 7) return 0.5;
  if (hour < 10) return 1;
  if (hour < 13) return 0.7;
  if (hour < 15) return 0.9;
  if (hour < 17) return 0.7;
  if (hour < 20) return 1;
  if (hour < 22) return 0.55;
  return 0.25;
}

type Meta = Record<string, string | number>;
interface Sample {
  t: number;
  lon: number;
  lat: number;
  heading: number;
  speed: number;
}

/** Instantes de una rejilla (`interval`, `phase`) dentro de `[from, to)`. */
function gridTimes(from: number, to: number, interval: number, phase: number): number[] {
  const first = Math.ceil((from - phase) / interval) * interval + phase;
  const out: number[] = [];
  for (let t = first; t < to; t += interval) out.push(t);
  return out;
}
/** Último instante de la rejilla estrictamente anterior a `from`. */
const gridBefore = (from: number, interval: number, phase: number): number =>
  Math.ceil((from - phase) / interval) * interval + phase - interval;

interface MobileSpec {
  id: string;
  interval: number;
  phase: number;
  active: (t: number) => boolean;
  at: (t: number) => Sample;
  meta: (t: number) => Meta;
  /** Antigüedad máxima del estado inicial (los umbrales de la API), ms. */
  maxAge: number;
}

function track(spec: MobileSpec, from: number, to: number) {
  const times = gridTimes(from, to, spec.interval, spec.phase).filter(spec.active);
  const prev = gridBefore(from, spec.interval, spec.phase);
  const hasInit = spec.active(prev) && from - prev <= spec.maxAge;
  if (times.length === 0 && !hasInit) return null;
  const samples = times.map(spec.at);
  const init = hasInit ? spec.at(prev) : null;
  const metaAt = times.length > 0 ? (times[times.length - 1] as number) : prev;
  return {
    id: spec.id,
    meta: spec.meta(metaAt),
    ...(init
      ? {
          init: {
            dt: init.t - from,
            lon: q(init.lon),
            lat: q(init.lat),
            heading: Math.round(init.heading),
            speed: qs(init.speed),
          },
        }
      : {}),
    ts: samples.map((s) => s.t - from),
    lon: samples.map((s) => q(s.lon)),
    lat: samples.map((s) => q(s.lat)),
    heading: samples.map((s) => Math.round(s.heading)),
    speed: samples.map((s) => qs(s.speed)),
  };
}

function busSpecs(count: number): MobileSpec[] {
  const out: MobileSpec[] = [];
  for (let i = 0; i < count; i++) {
    const routeId = ROUTE_IDS[i % ROUTE_IDS.length] as string;
    const route = ROUTES[routeId] as Parameters<typeof routeGeometry>[0];
    const { lengths, total } = routeGeometry(route);
    const speed = 3 + frac(i * 0.618034) * 7;
    const s0 = frac(i * 0.754878) * total;
    const rank = frac(i * 0.381966 + 0.07);
    const id = `mock-bus-${routeId}-${String(i).padStart(4, "0")}`;
    const place = (t: number) => pointAt({ route, lengths, total, s: s0 + speed * (t / 1000) });
    out.push({
      id,
      interval: 15_000,
      phase: (i * 1237) % 15_000,
      maxAge: 5 * 60_000,
      active: (t) => rank < fleetActivity(madridHour(t)),
      at: (t) => {
        const p = place(t);
        return { t, lon: p.lon, lat: p.lat, heading: p.heading, speed };
      },
      meta: (t) => ({
        line: routeId,
        headsign: `Destino ${routeId}`,
        nextStop: `Parada ${routeId}-${place(t).segment + 1}`,
        ...(i % 2 === 1 ? { estimated: 1, source: "schedule" } : {}),
        simulated: 1,
      }),
    });
  }
  return out;
}

function shipSpecs(): MobileSpec[] {
  return SHIP_SPECS.map((spec, i) => {
    const route = SHIP_ROUTES[i % SHIP_ROUTES.length] as Parameters<typeof routeGeometry>[0];
    const { lengths, total } = routeGeometry(route);
    const speed = spec.knots * KNOT;
    const moored = spec.moored !== undefined;
    const lap = moored ? 1 : (2 * total) / speed;
    const s0 = frac(i * 0.61803) * lap;
    const at = (t: number): Sample => {
      if (spec.moored) {
        return {
          t,
          lon: spec.moored[0],
          lat: spec.moored[1],
          heading: spec.heading ?? 0,
          speed: 0,
        };
      }
      // Ping-pong sobre la ruta: ida (rumbo de la ruta) y vuelta (rumbo opuesto).
      const u = (s0 + t / 1000) % lap;
      const forward = u <= lap / 2;
      const s = (forward ? u : lap - u) * speed;
      const p = pointAt({ route, lengths, total, s: Math.min(s, total - 0.01) });
      return {
        t,
        lon: p.lon,
        lat: p.lat,
        heading: (p.heading + (forward ? 0 : 180)) % 360,
        speed,
      };
    };
    return {
      id: `mock-ship-${String(i).padStart(2, "0")}`,
      interval: moored ? 30_000 : 10_000,
      phase: (i * 3571) % 10_000,
      maxAge: 5 * 60_000,
      active: () => true,
      at,
      meta: () => ({
        ...(spec.name ? { name: spec.name } : {}),
        ...(spec.type !== undefined ? { shipType: spec.type } : {}),
        navStatus: moored ? 5 : 0,
        simulated: 1,
      }),
    };
  });
}

function planeSpecs(): MobileSpec[] {
  const approach = 40_000;
  const mk = (
    id: string,
    callsign: string,
    kind: "landing" | "cruise",
    origin: readonly [number, number],
    heading: number,
    length: number,
    speed: number,
    altitude: number,
    cycleMs: number,
    shiftMs: number,
  ): MobileSpec => {
    const along = (t: number): number => (((t + shiftMs) % cycleMs) / 1000) * speed;
    return {
      id,
      interval: 60_000,
      phase: 0,
      maxAge: 5 * 60_000,
      active: (t) => along(t) < length,
      at: (t) => {
        const s = along(t);
        const [lon, lat] = offset(origin as [number, number], heading, s);
        return { t, lon, lat, heading, speed };
      },
      meta: (t) => {
        const s = along(t);
        const frac1 = kind === "landing" ? 1 - s / length : 1;
        return {
          source: "opensky",
          callsign,
          alt: Math.round(altitude * Math.max(0, frac1)),
          onGround: 0,
          vrate: kind === "landing" ? -4 : 0,
          simulated: 1,
        };
      },
    };
  };
  return [
    mk(
      "mock-plane-lcg001",
      "MOCK101",
      "landing",
      offset(ALVEDRO, 31, approach),
      211,
      approach,
      110,
      2800,
      30 * 60_000,
      0,
    ),
    mk(
      "mock-plane-xtr002",
      "MOCK202",
      "cruise",
      [-8.66, 43.42],
      82,
      50_000,
      90,
      9500,
      25 * 60_000,
      7 * 60_000,
    ),
  ];
}

function bikeStations(from: number, to: number) {
  const interval = 60_000;
  return STATIONS.map(([lon, lat], i) => {
    const capacity = 16 + ((i * 7) % 10);
    const bikesAt = (t: number): number => {
      const wave = 0.5 + 0.38 * Math.sin((2 * Math.PI * t) / DAY_MS + i * 0.9);
      return Math.max(0, Math.min(capacity, Math.round(wave * capacity)));
    };
    const prev = gridBefore(from, interval, 0);
    const ts: number[] = [];
    const bikes: number[] = [];
    let last = bikesAt(prev);
    for (const t of gridTimes(from, to, interval, 0)) {
      const b = bikesAt(t);
      if (b === last) continue;
      last = b;
      ts.push(t - from);
      bikes.push(b);
    }
    const b0 = bikesAt(prev);
    return {
      id: `mock-bici-${String(i).padStart(3, "0")}`,
      lon: q(lon),
      lat: q(lat),
      init: { dt: prev - from, bikes: b0, docks: capacity - b0 },
      ts,
      bikes,
      docks: bikes.map((b) => capacity - b),
    };
  });
}

interface SeriesDef {
  stationId: string;
  metric: string;
  unit: string;
  interval: number;
  /** El instante de la muestra y su valor (`hour`: instante de rejilla). */
  value: (t: number) => number;
}

function seriesFor(layer: "weather" | "sea" | "air"): SeriesDef[] {
  if (layer === "weather") {
    return WEATHER_STATIONS.flatMap((stationId, i) => [
      {
        stationId,
        metric: "wind_speed",
        unit: "m/s",
        interval: 300_000,
        value: (t: number) =>
          round1(
            Math.max(0.5, 4 + 2.5 * Math.sin((2 * Math.PI * t) / (6 * HOUR_MS) + i) + i * 0.7),
          ),
      },
      {
        stationId,
        metric: "wind_dir",
        unit: "deg",
        interval: 300_000,
        value: (t: number) =>
          Math.round((220 + 40 * Math.sin((2 * Math.PI * t) / (9 * HOUR_MS)) + i * 12 + 360) % 360),
      },
    ]);
  }
  if (layer === "sea") {
    return [
      {
        stationId: "portus:3219",
        metric: "tide_level",
        unit: "m",
        interval: 300_000,
        value: mockTideLevel,
      },
    ];
  }
  const eaqi = (t: number): number => Math.max(3, 29 + 8 * Math.sin((2 * Math.PI * t) / DAY_MS));
  const air = (metric: string, unit: string, f: (e: number) => number): SeriesDef => ({
    stationId: AIR_STATION,
    metric,
    unit,
    interval: HOUR_MS,
    value: (t) => f(eaqi(t)),
  });
  return [
    air("pm25", "µg/m³", (e) => round1(e * 0.14)),
    air("pm10", "µg/m³", (e) => round1(e * 0.35)),
    air("no2", "µg/m³", (e) => round1(e * 0.09)),
    air("o3", "µg/m³", (e) => Math.round(60 + e * 0.6)),
    air("so2", "µg/m³", (e) => round1(e * 0.02)),
    air("eaqi", "EAQI", (e) => Math.round(e)),
  ];
}

function seriesWindow(layer: "weather" | "sea" | "air", from: number, to: number) {
  return seriesFor(layer).map((d) => {
    const times = gridTimes(from, to, d.interval, 0);
    const prev = gridBefore(from, d.interval, 0);
    return {
      stationId: d.stationId,
      metric: d.metric,
      unit: d.unit,
      init: { dt: prev - from, value: d.value(prev) },
      ts: times.map((t) => t - from),
      value: times.map(d.value),
    };
  });
}

const MOBILE_SPECS: Record<"bus" | "ship" | "plane", (buses: number) => MobileSpec[]> = {
  bus: busSpecs,
  ship: shipSpecs,
  plane: planeSpecs,
};

export const MOCK_LAYERS: readonly LayerId[] = [
  "bus",
  "bike",
  "weather",
  "sea",
  "ship",
  "air",
  "plane",
  "train",
];

export interface MockReplayOptions {
  buses?: number;
  /** Ahora (epoch ms), para el límite de retención simulado. */
  now: number;
}

/**
 * Ventana `[from, to)` de las capas pedidas. Fuera de los últimos `MOCK_RETENTION_DAYS` días
 * devuelve cada capa vacía (el servidor real haría lo mismo sin datos grabados).
 */
export function mockReplayWindow(
  from: number,
  to: number,
  layers: readonly LayerId[],
  opts: MockReplayOptions,
): ReplayWindow {
  const recorded = from >= opts.now - MOCK_RETENTION_DAYS * DAY_MS;
  const ordered = MOCK_LAYERS.filter((l) => layers.includes(l));
  const out: Record<string, unknown> = {};
  for (const layer of ordered) {
    if (layer === "bike") {
      out[layer] = { kind: "station", stations: recorded ? bikeStations(from, to) : [] };
    } else if (layer === "weather" || layer === "sea" || layer === "air") {
      out[layer] = { kind: "series", series: recorded ? seriesWindow(layer, from, to) : [] };
    } else {
      const specs =
        recorded && (layer === "bus" || layer === "ship" || layer === "plane")
          ? MOBILE_SPECS[layer](opts.buses ?? 60)
          : [];
      out[layer] = {
        kind: "mobile",
        tracks: specs
          .map((spec) => track(spec, from, to))
          .filter((t): t is NonNullable<typeof t> => t !== null)
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      };
    }
  }
  return { v: 1, from, to, resolution: "raw", layers: out } as unknown as ReplayWindow;
}

export interface MockReplayResponse {
  status: number;
  headers: Record<string, string>;
  /** `window` se codifica en MessagePack; en errores, un objeto JSON. */
  window?: ReplayWindow;
  error?: { error: string; message: string };
}

/** Valida la petición como el servidor real (docs M6.2) y devuelve la ventana o un 400. */
export function handleMockReplay(
  search: URLSearchParams,
  opts: MockReplayOptions,
): MockReplayResponse {
  const bad = (message: string): MockReplayResponse => ({
    status: 400,
    headers: { "Cache-Control": "no-store" },
    error: { error: "bad_request", message },
  });
  const int = (v: string | null): number | null =>
    v !== null && /^\d+$/.test(v) ? Number(v) : null;
  const from = int(search.get("from"));
  const to = int(search.get("to"));
  if (from === null || to === null || from <= 1e11 || to <= 1e11) {
    return bad("from y to deben ser epoch ms (enteros)");
  }
  if (to <= from || to - from > WINDOW_MS) return bad("0 < to − from ≤ 5 min");
  if (from > opts.now) return bad("from está en el futuro");
  const raw = search.get("layers");
  let layers: LayerId[] = [...MOCK_LAYERS];
  if (raw !== null) {
    const asked = raw.split(",");
    if (asked.some((l) => !MOCK_LAYERS.includes(l as LayerId)) || raw === "") {
      return bad("capa desconocida");
    }
    layers = asked as LayerId[];
  }
  const aligned = from % WINDOW_MS === 0 && to - from === WINDOW_MS;
  const settled = to <= opts.now - 10 * 60_000;
  return {
    status: 200,
    headers: {
      "Content-Type": "application/msgpack",
      "Cache-Control": aligned && settled ? "public, max-age=3600" : "public, max-age=10",
    },
    window: mockReplayWindow(from, to, layers, opts),
  };
}
