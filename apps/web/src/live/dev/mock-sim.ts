import type {
  DeltaMessage,
  Entity,
  Observation,
  SnapshotMessage,
  StationStatus,
} from "@pulso/schema";

/**
 * Simulador SOLO DE DESARROLLO de la API en vivo (bus, bici, viento). Lo usa únicamente el plugin
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

const WEATHER_STATIONS = ["mock-w1", "mock-w2", "mock-w3"] as const;

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

function pointAt(bus: Bus): { lon: number; lat: number; heading: number; segment: number } {
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
  private readonly intervals: { bus: number; bike: number; weather: number };
  private nextDue = { bus: 0, bike: 0, weather: 0 };
  private lastStep = 0;
  private wind = { speed: 4, dir: 220 };

  constructor(opts: MockWorldOptions = {}) {
    this.rng = createRng(opts.seed ?? 1);
    this.intervals = {
      bus: opts.busIntervalMs ?? 5000,
      bike: opts.bikeIntervalMs ?? 15_000,
      weather: opts.weatherIntervalMs ?? 30_000,
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

  snapshot(now: number): SnapshotMessage {
    this.lastStep = now;
    this.nextDue = {
      bus: now + this.intervals.bus,
      bike: now + this.intervals.bike,
      weather: now + this.intervals.weather,
    };
    return {
      v: 1,
      type: "snapshot",
      ts: now,
      layers: {
        bus: this.buses.filter((b) => b.active).map((b) => this.busEntity(b, now)),
        bike: this.stations.map((s) => this.bikeStatus(s, now)),
        weather: this.windObservations(now),
      },
    };
  }

  /** Avanza la simulación hasta `now` y devuelve los deltas que toquen. */
  step(now: number): DeltaMessage[] {
    const dt = Math.max(0, now - this.lastStep) / 1000;
    this.lastStep = now;
    for (const b of this.buses) if (b.active) b.s += b.speed * dt;
    const out: DeltaMessage[] = [];

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
    return out;
  }
}
