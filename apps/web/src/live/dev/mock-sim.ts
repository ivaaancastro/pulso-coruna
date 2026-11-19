import type {
  DeltaMessage,
  Entity,
  Observation,
  SnapshotMessage,
  StationStatus,
} from "@pulso/schema";

/**
 * Simulador SOLO DE DESARROLLO de la API en vivo (bus, bici, viento, barcos, aire, aviones). Lo usa únicamente el plugin
 * de Vite `vite/mock-live-plugin.mjs` (servidor de desarrollo, con PULSO_MOCK_LIVE=1); el cliente
 * no lo importa, así que no entra en el bundle. Todo dato lleva `meta.simulated`/ids `mock-`.
 */

/** Generador pseudoaleatorio determinista (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type LonLat = readonly [number, number];

/** Trazados inventados sobre la península (no son líneas reales). */
const ROUTES: Record<string, readonly LonLat[]> = {
  S1: [
    [-8.4105, 43.3703],
    [-8.4056, 43.3669],
    [-8.4, 43.3694],
    [-8.4025, 43.3733],
    [-8.4105, 43.3703],
  ],
  S2: [
    [-8.4065, 43.3755],
    [-8.4119, 43.3699],
    [-8.4185, 43.3694],
    [-8.4225, 43.3735],
    [-8.4167, 43.3785],
    [-8.4065, 43.3755],
  ],
  S3: [
    [-8.3985, 43.3623],
    [-8.4066, 43.3641],
    [-8.4121, 43.3611],
    [-8.4072, 43.3578],
    [-8.3985, 43.3623],
  ],
};
const ROUTE_IDS = Object.keys(ROUTES);

const STATIONS: readonly LonLat[] = [
  [-8.4066, 43.3711], [-8.4048, 43.3693], [-8.4012, 43.3698], [-8.4094, 43.3687],
  [-8.4137, 43.3702], [-8.4182, 43.3707], [-8.4211, 43.3731], [-8.4162, 43.3767],
  [-8.4103, 43.3739], [-8.4065, 43.3755], [-8.4023, 43.3722], [-8.3987, 43.3668],
  [-8.4031, 43.3646], [-8.4079, 43.3619], [-8.4118, 43.3647], [-8.4156, 43.3668],
]; // prettier-ignore

/** Rutas inventadas de barcos: de la bocana al puerto (no son derrotas reales). */
const SHIP_ROUTES: readonly (readonly LonLat[])[] = [
  [
    [-8.3505, 43.3748],
    [-8.3647, 43.3679],
    [-8.3741, 43.3634],
    [-8.3805, 43.3634],
    [-8.3851, 43.3637],
  ],
  [
    [-8.3509, 43.37],
    [-8.3635, 43.3647],
    [-8.3731, 43.3614],
    [-8.3792, 43.3613],
  ],
  [
    [-8.3624, 43.3788],
    [-8.3677, 43.3715],
    [-8.3722, 43.3641],
    [-8.3781, 43.3633],
    [-8.3823, 43.363],
  ],
];

/** Barcos ficticios: tipo AIS, nombre, nudos y estado (los amarrados no se mueven). */
const SHIP_SPECS: readonly {
  type?: number;
  name?: string;
  knots: number;
  moored?: LonLat;
  heading?: number;
}[] = [
  { type: 71, name: "MOCK CARGO ONE", knots: 8 },
  { type: 82, name: "MOCK TANKER", knots: 7 },
  { type: 69, name: "MOCK FERRY", knots: 11 },
  { type: 30, name: "MOCK TRAWLER", knots: 6 },
  { type: 52, name: "MOCK TUG", knots: 5 },
  { type: 37, name: "MOCK YACHT", knots: 5 },
  { type: 36, name: "MOCK SAIL", knots: 4 },
  { knots: 6 },
  { type: 79, name: "MOCK BOX", knots: 0, moored: [-8.3845, 43.3618], heading: 270 },
  { type: 80, name: "MOCK OIL", knots: 0, moored: [-8.3971, 43.3691], heading: 180 },
  { type: 60, name: "MOCK CRUISE", knots: 0, moored: [-8.3666, 43.3626], heading: 20 },
  { type: 37, name: "MOCK SLOOP", knots: 0, moored: [-8.3919, 43.3652], heading: 250 },
  { type: 30, name: "MOCK NETS", knots: 0, moored: [-8.3871, 43.3669], heading: 300 },
  { type: 31, name: "MOCK TOW", knots: 0, moored: [-8.3797, 43.3649], heading: 200 },
];
/** Alvedro (LCG) y aviones ficticios: uno aterriza, otro cruza (no son vuelos reales). */
const ALVEDRO: LonLat = [-8.3772, 43.3021];

interface SimPlane {
  id: string;
  callsign: string;
  kind: "landing" | "cruise";
  /** Origen del trayecto, rumbo (grados), longitud (m), velocidad (m/s) y altitud de crucero (m). */
  origin: LonLat;
  heading: number;
  length: number;
  speed: number;
  altitude: number;
  /** Distancia recorrida, m. */
  s: number;
  active: boolean;
  /** Actualizaciones ya emitidas en tierra (el aterrizado desaparece tras dos). */
  groundedUpdates: number;
}

function offset(origin: LonLat, headingDeg: number, meters: number): LonLat {
  const rad = (headingDeg * Math.PI) / 180;
  return [
    origin[0] + (Math.sin(rad) * meters) / (M_LAT * Math.cos((origin[1] * Math.PI) / 180)),
    origin[1] + (Math.cos(rad) * meters) / M_LAT,
  ];
}

function makePlanes(): SimPlane[] {
  const approach = 40_000;
  return [
    {
      id: "mock-plane-lcg001",
      callsign: "MOCK101",
      kind: "landing",
      // Llega desde el nordeste con rumbo 211 y toca pista en Alvedro.
      origin: offset(ALVEDRO, 31, approach),
      heading: 211,
      length: approach,
      speed: 110,
      altitude: 2800,
      s: approach * 0.55,
      active: true,
      groundedUpdates: 0,
    },
    {
      id: "mock-plane-xtr002",
      callsign: "MOCK202",
      kind: "cruise",
      origin: [-8.66, 43.42],
      heading: 82,
      length: 50_000,
      speed: 90,
      altitude: 9500,
      s: 9000,
      active: true,
      groundedUpdates: 0,
    },
  ];
}

const WEATHER_STATIONS = ["mock-w1", "mock-w2", "mock-w3"] as const;
/** Como en producción, el sufijo `:model` marca un dato de modelo (una sola celda para toda la ciudad). */
const AIR_STATION = "mock:coruna:model";
const HOUR_MS = 3_600_000;

interface Bus {
  id: string;
  route: readonly LonLat[];
  lengths: number[];
  total: number;
  /** Distancia recorrida sobre el trazado, m. */
  s: number;
  speed: number;
  active: boolean;
}

interface Ship {
  id: string;
  type?: number;
  name?: string;
  route: readonly LonLat[];
  lengths: number[];
  total: number;
  /** Distancia recorrida sobre la ruta, m. */
  s: number;
  /** +1 entrando, −1 saliendo. */
  dir: 1 | -1;
  speed: number;
  /** Amarrado o fondeado: sin movimiento. */
  moored: boolean;
  fixed?: { lon: number; lat: number; heading: number };
  /** Hasta cuándo permanece atracado / fuera de escena, ms. */
  until: number;
  active: boolean;
  nextReport: number;
}

const KNOT = 0.514444;
/** Tiempo atracado y fuera de escena (solo para que la demo no se quede vacía), ms. */
const DWELL_MS = 45_000;
const AWAY_MS = 20_000;

const M_LAT = 111_320;

function routeGeometry(route: readonly LonLat[]): { lengths: number[]; total: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as LonLat;
    const b = route[i] as LonLat;
    const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * M_LAT;
    const dy = (b[1] - a[1]) * M_LAT;
    const len = Math.hypot(dx, dy);
    lengths.push(len);
    total += len;
  }
  return { lengths, total };
}

function pointAt(bus: Pick<Bus, "route" | "lengths" | "total" | "s">): {
  lon: number;
  lat: number;
  heading: number;
  segment: number;
} {
  let s = bus.s % bus.total;
  for (let i = 0; i < bus.lengths.length; i++) {
    const len = bus.lengths[i] as number;
    if (s <= len) {
      const a = bus.route[i] as LonLat;
      const b = bus.route[i + 1] as LonLat;
      const u = len === 0 ? 0 : s / len;
      const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
      const dy = b[1] - a[1];
      const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      return { lon: a[0] + (b[0] - a[0]) * u, lat: a[1] + (b[1] - a[1]) * u, heading, segment: i };
    }
    s -= len;
  }
  const last = bus.route[bus.route.length - 1] as LonLat;
  return { lon: last[0], lat: last[1], heading: 0, segment: 0 };
}

export interface MockWorldOptions {
  buses?: number;
  seed?: number;
  /** Cada cuánto emite posiciones de bus (como un AVL real), ms. */
  busIntervalMs?: number;
  /** Cada cuánto emite cambios de estaciones de bici, ms. */
  bikeIntervalMs?: number;
  /** Cada cuánto emite el viento, ms. */
  weatherIntervalMs?: number;
  /** Cuántos de los barcos ficticios simula (0 = ninguno, por defecto todos). */
  ships?: number;
  /** Cada cuánto emite el nivel del mar (la fuente real, cada ~5 min; aquí más rápido), ms. */
  seaIntervalMs?: number;
  /** Cada cuánto emite el aire (modelo horario), ms. */
  airIntervalMs?: number;
  /** Cada cuánto emite aviones (OpenSky anónimo: 5 min), ms. */
  planeIntervalMs?: number;
}

/** Marea semidiurna ficticia: periodo lunar de 12,42 h, nivel medio 2,3 m, amplitud 1,5 m. */
export function mockTideLevel(ts: number): number {
  const phase = (2 * Math.PI * ts) / (12.42 * HOUR_MS);
  return Math.round((2.3 + 1.5 * Math.sin(phase)) * 1000) / 1000;
}

/** Mundo simulado con el mismo contrato que la API (`snapshot` y luego `delta`). */
export class MockWorld {
  private readonly rng: () => number;
  private readonly buses: Bus[] = [];
  private readonly stations: {
    id: string;
    lon: number;
    lat: number;
    capacity: number;
    bikes: number;
  }[];
  private readonly ships: Ship[] = [];
  private readonly planes = makePlanes();
  private readonly intervals: {
    bus: number;
    bike: number;
    weather: number;
    sea: number;
    air: number;
    plane: number;
  };
  private nextDue = { bus: 0, bike: 0, weather: 0, sea: 0, air: 0, plane: 0 };
  private lastStep = 0;
  private wind = { speed: 4, dir: 220 };
  /** EAQI ficticio (escala de Open-Meteo, 0–100+): deriva despacio. */
  private eaqi = 29;

  constructor(opts: MockWorldOptions = {}) {
    this.rng = createRng(opts.seed ?? 1);
    this.intervals = {
      bus: opts.busIntervalMs ?? 5000,
      bike: opts.bikeIntervalMs ?? 15_000,
      weather: opts.weatherIntervalMs ?? 30_000,
      sea: opts.seaIntervalMs ?? 60_000,
      air: opts.airIntervalMs ?? 60_000,
      plane: opts.planeIntervalMs ?? 300_000,
    };
    const count = opts.buses ?? 60;
    for (let i = 0; i < count; i++) {
      const routeId = ROUTE_IDS[i % ROUTE_IDS.length] as string;
      const route = ROUTES[routeId] as readonly LonLat[];
      const { lengths, total } = routeGeometry(route);
      this.buses.push({
        id: `mock-bus-${routeId}-${String(i).padStart(4, "0")}`,
        route,
        lengths,
        total,
        s: this.rng() * total,
        speed: 3 + this.rng() * 7,
        active: true,
      });
    }
    SHIP_SPECS.slice(0, opts.ships ?? SHIP_SPECS.length).forEach((spec, i) => {
      const route = SHIP_ROUTES[i % SHIP_ROUTES.length] as readonly LonLat[];
      const { lengths, total } = routeGeometry(route);
      const moored = spec.moored !== undefined;
      this.ships.push({
        id: `mock-ship-${String(i).padStart(2, "0")}`,
        type: spec.type,
        name: spec.name,
        route,
        lengths,
        total,
        s: moored ? 0 : this.rng() * total * 0.9,
        dir: 1,
        speed: spec.knots * KNOT,
        moored,
        fixed: spec.moored && {
          lon: spec.moored[0],
          lat: spec.moored[1],
          heading: spec.heading ?? 0,
        },
        until: 0,
        active: true,
        nextReport: 0,
      });
    });
    this.stations = STATIONS.map(([lon, lat], i) => {
      const capacity = 16 + Math.floor(this.rng() * 10);
      return {
        id: `mock-bici-${String(i).padStart(3, "0")}`,
        lon,
        lat,
        capacity,
        bikes: Math.floor(this.rng() * (capacity + 1)),
      };
    });
  }

  private busEntity(b: Bus, ts: number): Entity {
    const p = pointAt(b);
    const routeId = b.id.split("-")[2] as string;
    return {
      id: b.id,
      layer: "bus",
      lon: p.lon,
      lat: p.lat,
      heading: Math.round(p.heading),
      speed: b.speed,
      ts,
      meta: {
        line: routeId,
        headsign: `Destino ${routeId}`,
        nextStop: `Parada ${routeId}-${p.segment + 1}`,
        // Como en producción (M4.3a) los buses pueden ser estimaciones por horario: la mitad lo es.
        ...(Number(b.id.slice(-4)) % 2 === 1 ? { estimated: 1, source: "schedule" } : {}),
        simulated: 1,
      },
    };
  }

  private shipEntity(sh: Ship, ts: number): Entity {
    // `pointAt` da la vuelta con `%`: atracado (s = total) se queda en el último punto.
    const p = sh.fixed ?? pointAt({ ...sh, s: Math.min(sh.s, sh.total - 0.01) });
    const heading = sh.fixed ? sh.fixed.heading : (p.heading + (sh.dir === 1 ? 0 : 180)) % 360;
    return {
      id: sh.id,
      layer: "ship",
      lon: p.lon,
      lat: p.lat,
      heading: Math.round(heading),
      speed: sh.moored ? 0 : sh.speed,
      ts,
      meta: {
        ...(sh.name ? { name: sh.name } : {}),
        ...(sh.type !== undefined ? { shipType: sh.type } : {}),
        navStatus: sh.moored ? 5 : 0,
        simulated: 1,
      },
    };
  }

  /** Avanza un barco: llega al muelle, atraca un rato y sale; al salir de escena vuelve a entrar. */
  private stepShip(sh: Ship, dt: number, now: number): "upsert" | "remove" | null {
    if (sh.fixed) return null;
    if (!sh.active) {
      if (now < sh.until) return null;
      sh.active = true;
      sh.s = 0;
      sh.dir = 1;
      sh.moored = false;
      return "upsert";
    }
    if (sh.moored) {
      if (now >= sh.until) {
        sh.moored = false; // zarpa
        sh.nextReport = 0; // y lo dice ya
      }
      return null;
    }
    sh.s += sh.dir * sh.speed * dt;
    if (sh.dir === 1 && sh.s >= sh.total) {
      sh.s = sh.total;
      sh.dir = -1;
      sh.moored = true;
      sh.until = now + DWELL_MS;
      sh.nextReport = 0; // informa ya de que ha atracado
    } else if (sh.dir === -1 && sh.s <= 0) {
      sh.active = false;
      sh.until = now + AWAY_MS;
      return "remove";
    }
    return null;
  }

  private bikeStatus(st: MockWorld["stations"][number], ts: number): StationStatus {
    return {
      id: st.id,
      layer: "bike",
      lon: st.lon,
      lat: st.lat,
      bikes: st.bikes,
      docks: st.capacity - st.bikes,
      ts,
    };
  }

  /** Avión en su posición real de hace `ageMs` (el dato de OpenSky llega con retraso). */
  private planeEntity(p: SimPlane, ts: number, ageMs: number): Entity {
    const along = Math.min(p.length, Math.max(0, p.s - p.speed * (ageMs / 1000)));
    const landed = p.kind === "landing" && p.s >= p.length;
    const [lon, lat] = landed ? ALVEDRO : offset(p.origin, p.heading, along);
    const frac = p.kind === "landing" ? 1 - along / p.length : 1;
    return {
      id: p.id,
      layer: "plane",
      lon,
      lat,
      heading: p.heading,
      speed: landed ? 0 : p.speed,
      ts,
      meta: {
        source: "opensky",
        callsign: p.callsign,
        alt: landed ? 0 : Math.round(p.altitude * frac),
        onGround: landed ? 1 : 0,
        vrate: landed ? 0 : p.kind === "landing" ? -4 : 0,
        simulated: 1,
      },
    };
  }

  private windObservations(ts: number): Observation[] {
    return WEATHER_STATIONS.flatMap((stationId, i) => [
      {
        stationId,
        layer: "weather" as const,
        metric: "wind_speed",
        value: Math.round((this.wind.speed + i * 0.7) * 10) / 10,
        unit: "m/s",
        ts,
      },
      {
        stationId,
        layer: "weather" as const,
        metric: "wind_dir",
        value: Math.round((this.wind.dir + i * 12) % 360),
        unit: "deg",
        ts,
      },
    ]);
  }

  /** Mismo `stationId` que el mareógrafo real: solo existe en desarrollo (este simulador). */
  private seaObservations(ts: number): Observation[] {
    return [
      {
        stationId: "portus:3219",
        layer: "sea",
        metric: "tide_level",
        value: mockTideLevel(ts),
        unit: "m",
        ts,
      },
    ];
  }

  /** Como la fuente real: valores de la hora en curso, con `ts` = inicio de la hora. */
  private airObservations(now: number): Observation[] {
    const ts = Math.floor(now / HOUR_MS) * HOUR_MS;
    const e = this.eaqi;
    const values: [string, number, string][] = [
      ["pm25", Math.round(e * 0.14 * 10) / 10, "µg/m³"],
      ["pm10", Math.round(e * 0.35 * 10) / 10, "µg/m³"],
      ["no2", Math.round(e * 0.09 * 10) / 10, "µg/m³"],
      ["o3", Math.round(60 + e * 0.6), "µg/m³"],
      ["so2", Math.round(e * 0.02 * 10) / 10, "µg/m³"],
      ["eaqi", Math.round(e), "EAQI"],
    ];
    return values.map(([metric, value, unit]) => ({
      stationId: AIR_STATION,
      layer: "air" as const,
      metric,
      value,
      unit,
      ts,
    }));
  }

  snapshot(now: number): SnapshotMessage {
    this.lastStep = now;
    for (const sh of this.ships) sh.nextReport = now + this.rng() * 10_000; // sin informar todos a la vez
    this.nextDue = {
      bus: now + this.intervals.bus,
      bike: now + this.intervals.bike,
      weather: now + this.intervals.weather,
      sea: now + this.intervals.sea,
      air: now + this.intervals.air,
      plane: now + this.intervals.plane,
    };
    return {
      v: 1,
      type: "snapshot",
      ts: now,
      layers: {
        bus: this.buses.filter((b) => b.active).map((b) => this.busEntity(b, now)),
        bike: this.stations.map((s) => this.bikeStatus(s, now)),
        weather: this.windObservations(now),
        ship: this.ships.filter((sh) => sh.active).map((sh) => this.shipEntity(sh, now)),
        sea: this.seaObservations(now),
        air: this.airObservations(now),
        // Como en producción, el dato lleva ~1,5 min de retraso: la capa ya extrapola al abrir.
        plane: this.planes
          .filter((p) => p.active)
          .map((p) => this.planeEntity(p, now - 90_000, 90_000)),
      },
    };
  }

  /** Avanza la simulación hasta `now` y devuelve los deltas que toquen. */
  step(now: number): DeltaMessage[] {
    const dt = Math.max(0, now - this.lastStep) / 1000;
    this.lastStep = now;
    for (const b of this.buses) if (b.active) b.s += b.speed * dt;
    for (const p of this.planes) if (p.active) p.s += p.speed * dt;
    const out: DeltaMessage[] = [];

    // Barcos: cada uno informa con su propio ritmo (segundos en marcha, más espaciado amarrado).
    const shipUp: Entity[] = [];
    const shipDown: string[] = [];
    for (const sh of this.ships) {
      const event = this.stepShip(sh, dt, now);
      if (event === "remove") shipDown.push(sh.id);
      else if (event === "upsert") shipUp.push(this.shipEntity(sh, now));
      else if (sh.active && now >= sh.nextReport) {
        sh.nextReport = now + (sh.moored ? 30_000 : 3000 + this.rng() * 12_000);
        shipUp.push(this.shipEntity(sh, now));
      }
    }
    if (shipUp.length > 0 || shipDown.length > 0) {
      out.push({ v: 1, type: "delta", ts: now, layer: "ship", upserts: shipUp, removes: shipDown });
    }

    if (now >= this.nextDue.bus) {
      this.nextDue.bus = now + this.intervals.bus;
      const upserts: Entity[] = [];
      const removes: string[] = [];
      for (const b of this.buses) {
        const r = this.rng();
        if (b.active && r < 0.01) {
          b.active = false; // el bus sale de servicio y desaparece
          removes.push(b.id);
        } else if (!b.active && r < 0.1) {
          b.active = true; // vuelve a entrar
          upserts.push(this.busEntity(b, now));
        } else if (b.active && r > 0.12) {
          upserts.push(this.busEntity(b, now)); // ~12 % no reporta en este ciclo
        }
      }
      out.push({ v: 1, type: "delta", ts: now, layer: "bus", upserts, removes });
    }

    if (now >= this.nextDue.bike) {
      this.nextDue.bike = now + this.intervals.bike;
      const upserts: StationStatus[] = [];
      for (const st of this.stations) {
        if (this.rng() > 0.35) continue;
        const change = Math.floor(this.rng() * 5) - 2;
        st.bikes = Math.min(st.capacity, Math.max(0, st.bikes + change));
        upserts.push(this.bikeStatus(st, now));
      }
      out.push({ v: 1, type: "delta", ts: now, layer: "bike", upserts, removes: [] });
    }

    if (now >= this.nextDue.plane) {
      this.nextDue.plane = now + this.intervals.plane;
      const upserts: Entity[] = [];
      const removes: string[] = [];
      for (const p of this.planes) {
        if (!p.active) {
          p.active = true; // un avión nuevo entra en la caja
          p.s = 0;
          p.groundedUpdates = 0;
        } else if (p.s >= p.length) {
          if (p.kind === "landing" && p.groundedUpdates++ < 2) {
            upserts.push(this.planeEntity(p, now - 20_000, 20_000));
            continue;
          }
          p.active = false; // aterrizado hace rato o fuera de la caja: desaparece
          removes.push(p.id);
          continue;
        }
        upserts.push(this.planeEntity(p, now - 20_000, 20_000));
      }
      out.push({ v: 1, type: "delta", ts: now, layer: "plane", upserts, removes });
    }

    if (now >= this.nextDue.weather) {
      this.nextDue.weather = now + this.intervals.weather;
      this.wind.speed = Math.max(0.5, this.wind.speed + (this.rng() - 0.5) * 2);
      this.wind.dir = (this.wind.dir + (this.rng() - 0.5) * 30 + 360) % 360;
      out.push({
        v: 1,
        type: "delta",
        ts: now,
        layer: "weather",
        upserts: this.windObservations(now),
        removes: [],
      });
    }
    if (now >= this.nextDue.sea) {
      this.nextDue.sea = now + this.intervals.sea;
      out.push({
        v: 1,
        type: "delta",
        ts: now,
        layer: "sea",
        upserts: this.seaObservations(now),
        removes: [],
      });
    }

    if (now >= this.nextDue.air) {
      this.nextDue.air = now + this.intervals.air;
      this.eaqi = Math.max(3, this.eaqi + (this.rng() - 0.5) * 8);
      out.push({
        v: 1,
        type: "delta",
        ts: now,
        layer: "air",
        upserts: this.airObservations(now),
        removes: [],
      });
    }
    return out;
  }
}
