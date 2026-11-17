export type LayerId = 'bus' | 'bike' | 'weather' | 'sea' | 'ship' | 'air' | 'plane' | 'train';

/** Móviles: bus, barco, avión, tren */
export interface Entity {
  id: string;            // estable dentro de la fuente
  layer: LayerId;
  lon: number;
  lat: number;
  heading?: number;      // grados, 0 = norte
  speed?: number;        // m/s
  ts: number;            // epoch ms, UTC
  meta?: Record<string, string | number>;
}

/** Estaciones de bicis */
export interface StationStatus {
  id: string;
  layer: 'bike';
  lon: number;
  lat: number;
  bikes: number;
  docks: number;
  ts: number;
}

/** Meteo, aire, mar */
export interface Observation {
  stationId: string;
  layer: 'weather' | 'air' | 'sea';
  metric: string;        // 'wind_speed', 'no2', 'tide_level'…
  value: number;
  unit: string;
  ts: number;
}

export interface Adapter<T> {
  id: string;
  intervalMs: number;
  fetch(signal: AbortSignal): Promise<unknown>;
  parse(raw: unknown): T[];
}
