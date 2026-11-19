import type { Entity, Observation, StationStatus } from "@pulso/schema";

/**
 * Generador de datos SINTÉTICOS coherentes (puerta de M6). Función pura del instante: mismo `t`, mismos datos.
 * Todo id lleva el prefijo `syn-` y `meta.synthetic = 1`: nada de esto es dato real.
 */
const HOUR = 3_600_000;
const CENTER = { lon: -8.4115, lat: 43.3623 };

const rad = (d: number): number => (d * Math.PI) / 180;
/** Metros → grados en A Coruña. */
const dLat = (m: number): number => m / 111_320;
const dLon = (m: number): number => m / (111_320 * Math.cos(rad(CENTER.lat)));
const round = (v: number, d = 5): number => Math.round(v * 10 ** d) / 10 ** d;

interface Loop {
  line: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  periodMs: number;
  buses: number;
}
const LOOPS: Loop[] = [
  { line: "1A", cx: 0, cy: 0, rx: 2800, ry: 1500, periodMs: 40 * 60_000, buses: 5 },
  { line: "3", cx: -800, cy: 1200, rx: 1600, ry: 2200, periodMs: 35 * 60_000, buses: 4 },
  { line: "12", cx: 1500, cy: -900, rx: 2400, ry: 1000, periodMs: 30 * 60_000, buses: 4 },
  { line: "24", cx: 500, cy: 300, rx: 3600, ry: 2600, periodMs: 55 * 60_000, buses: 3 },
];

/** Servicio de buses 05:00–22:59 UTC; de noche no hay datos (así se ve «sin datos» y la vida útil). */
const busActive = (t: number): boolean => {
  const h = new Date(t).getUTCHours();
  return h >= 5 && h < 23;
};

export function busesAt(t: number): Entity[] {
  if (!busActive(t)) return [];
  const out: Entity[] = [];
  for (const l of LOOPS) {
    for (let k = 0; k < l.buses; k++) {
      const phase = (t / l.periodMs + k / l.buses) % 1;
      const a = 2 * Math.PI * phase;
      const x = l.cx + l.rx * Math.cos(a);
      const y = l.cy + l.ry * Math.sin(a);
      // Derivada → rumbo (0° = norte, horario) y velocidad (m/s).
      const vx = -l.rx * Math.sin(a);
      const vy = l.ry * Math.cos(a);
      const heading = (Math.round((Math.atan2(vx, vy) * 180) / Math.PI) + 360) % 360;
      const speed =
        Math.round(((Math.hypot(vx, vy) * 2 * Math.PI) / (l.periodMs / 1000)) * 10) / 10;
      out.push({
        id: `syn-bus-${l.line}-${k}`,
        layer: "bus",
        lon: round(CENTER.lon + dLon(x)),
        lat: round(CENTER.lat + dLat(y)),
        heading,
        speed,
        ts: t,
        meta: { line: l.line, headsign: `Destino ${l.line}`, synthetic: 1 },
      });
    }
  }
  return out;
}

/** Barcos: entran por la bocana, atracan y salen (ciclo de 3 h); uno fondeado. */
export function shipsAt(t: number): Entity[] {
  const out: Entity[] = [];
  const names = ["SYN FERRY", "SYN TANKER", "SYN FISHER"];
  names.forEach((name, i) => {
    const cycle = 3 * HOUR;
    const p = ((t + i * HOUR) % cycle) / cycle; // 0..1
    // 0–0,4 entra, 0,4–0,6 atracado, 0,6–1 sale.
    const from = { x: -3500, y: 4200 };
    const dock = { x: 600 + i * 150, y: 450 };
    const s = p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    const moored = p >= 0.4 && p < 0.6;
    const x = from.x + (dock.x - from.x) * s;
    const y = from.y + (dock.y - from.y) * s;
    const dir = p < 0.6 ? 1 : -1;
    const hd = (Math.atan2((dock.x - from.x) * dir, (dock.y - from.y) * dir) * 180) / Math.PI;
    out.push({
      id: `syn-ship-${i}`,
      layer: "ship",
      lon: round(CENTER.lon + dLon(x)),
      lat: round(CENTER.lat + dLat(y)),
      heading: (Math.round(hd) + 360) % 360,
      speed: moored ? 0 : 5.5,
      ts: t,
      meta: { name, shipType: 70 + i, navStatus: moored ? 5 : 0, synthetic: 1 },
    });
  });
  out.push({
    id: "syn-ship-anchored",
    layer: "ship",
    lon: -8.395,
    lat: 43.375,
    heading: 120,
    speed: 0,
    ts: t,
    meta: { name: "SYN ANCHOR", shipType: 80, navStatus: 1, synthetic: 1 },
  });
  return out;
}

/** Aviones: pasadas de 12 min cada hora (dos aviones desfasados 30 min). */
export function planesAt(t: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < 2; i++) {
    const slot = (t + i * 30 * 60_000) % HOUR;
    if (slot > 12 * 60_000) continue;
    const s = slot / (12 * 60_000);
    const x = -9000 + 18_000 * s;
    const y = -3000 + 1500 * i + 2500 * s;
    out.push({
      id: `syn-plane-${i}`,
      layer: "plane",
      lon: round(CENTER.lon + dLon(x)),
      lat: round(CENTER.lat + dLat(y)),
      heading: 75 + i * 10,
      speed: 70,
      ts: t,
      meta: { callsign: `SYN${100 + i}`, synthetic: 1 },
    });
  }
  return out;
}

const STATIONS = Array.from({ length: 16 }, (_, i) => ({
  id: `syn-st-${String(i).padStart(2, "0")}`,
  lon: round(CENTER.lon + dLon(-3000 + (i % 4) * 2000 + (i % 3) * 120)),
  lat: round(CENTER.lat + dLat(-2000 + Math.floor(i / 4) * 1400 + (i % 2) * 90)),
  capacity: 18 + (i % 3) * 4,
}));

/** Estaciones de bici: ocupación con ritmo diario distinto por estación. */
export function stationsAt(t: number): StationStatus[] {
  return STATIONS.map((s, i) => {
    const day = (2 * Math.PI * t) / (24 * HOUR);
    const f = 0.5 + 0.4 * Math.sin(day + i * 0.7);
    const bikes = Math.max(0, Math.min(s.capacity, Math.round(s.capacity * f)));
    return {
      id: s.id,
      layer: "bike",
      lon: s.lon,
      lat: s.lat,
      bikes,
      docks: s.capacity - bikes,
      ts: t,
    };
  });
}

/** Viento en 3 estaciones y marea (cada 5 min); aire modelado (cada hora). */
export function observationsAt(t: number): Observation[] {
  const out: Observation[] = [];
  const obs = (
    layer: "weather" | "sea" | "air",
    stationId: string,
    metric: string,
    unit: string,
    value: number,
  ): void => {
    out.push({ stationId, metric, unit, value, layer, ts: t });
  };
  if (t % 300_000 === 0) {
    for (let i = 0; i < 3; i++) {
      const w = 4 + 2.5 * Math.sin((2 * Math.PI * t) / (6 * HOUR) + i) + i * 0.7;
      obs("weather", `syn-w${i + 1}`, "wind_speed", "m/s", round(Math.max(0.5, w), 1));
      const d = 220 + 40 * Math.sin((2 * Math.PI * t) / (9 * HOUR)) + i * 12;
      obs("weather", `syn-w${i + 1}`, "wind_dir", "deg", Math.round((d + 360) % 360));
    }
    const tide = round(2 + 1.8 * Math.sin((2 * Math.PI * t) / (12.42 * HOUR)), 2);
    obs("sea", "syn-portus", "tide_level", "m", tide);
  }
  if (t % HOUR === 0) {
    const eaqi = Math.max(3, 29 + 8 * Math.sin((2 * Math.PI * t) / (24 * HOUR)));
    const air = (m: string, u: string, v: number): void => obs("air", "syn-air", m, u, v);
    air("pm25", "µg/m³", round(eaqi * 0.14, 1));
    air("pm10", "µg/m³", round(eaqi * 0.35, 1));
    air("no2", "µg/m³", round(eaqi * 0.09, 1));
    air("o3", "µg/m³", Math.round(60 + eaqi * 0.6));
    air("eaqi", "EAQI", Math.round(eaqi));
  }
  return out;
}

export interface Tick {
  positions: Entity[];
  stations: StationStatus[];
  observations: Observation[];
}

/** Lo que «llega» en el instante `t` (ms, múltiplo de 15 s): cada capa a su cadencia. */
export function tickAt(t: number): Tick {
  const positions = [...busesAt(t), ...shipsAt(t)];
  if (t % 30_000 === 0) positions.push(...planesAt(t));
  return {
    positions,
    stations: t % 60_000 === 0 ? stationsAt(t) : [],
    observations: observationsAt(t),
  };
}
