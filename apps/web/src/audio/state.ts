import type { LayerId, LayerItem } from "@pulso/schema";

/** Lo que el sonido necesita saber de cada capa (todo derivado del almacén, nada del reloj). */
export interface SoundState {
  bus: { count: number };
  /** `availability` 0–1: bicis disponibles sobre bicis + huecos. */
  bike: { stations: number; availability: number };
  /** Nivel de marea normalizado 0–1 (`null`: sin dato). */
  sea: { tide: number | null };
  /** Velocidad del viento en m/s (`null`: sin dato). */
  wind: { speed: number | null };
  /** Nivel 0–6 aproximado del índice europeo de aire (0: sin dato). */
  air: { level: number };
  /** Barcos en movimiento. */
  ship: { count: number };
  plane: { count: number };
}

export interface ItemsReader {
  items(layer: LayerId): ReadonlyMap<string, LayerItem>;
}

/** Marea de A Coruña: ~0–5 m sobre el cero del mareógrafo. */
export const TIDE_RANGE_M = { min: 0, max: 5 } as const;
export const WIND_MAX_MS = 20;

export const SILENT_STATE: SoundState = {
  bus: { count: 0 },
  bike: { stations: 0, availability: 0.5 },
  sea: { tide: null },
  wind: { speed: null },
  air: { level: 0 },
  ship: { count: 0 },
  plane: { count: 0 },
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Extrae el `SoundState` del almacén (en vivo o de Reproducir: la misma vista). */
export function readSoundState(store: ItemsReader): SoundState {
  let bikes = 0;
  let docks = 0;
  let stations = 0;
  for (const item of store.items("bike").values()) {
    if ("bikes" in item) {
      bikes += item.bikes;
      docks += item.docks;
      stations++;
    }
  }

  let tide: number | null = null;
  for (const item of store.items("sea").values()) {
    if ("metric" in item && item.metric === "tide_level" && Number.isFinite(item.value)) {
      tide = clamp01((item.value - TIDE_RANGE_M.min) / (TIDE_RANGE_M.max - TIDE_RANGE_M.min));
    }
  }

  let windSum = 0;
  let windN = 0;
  for (const item of store.items("weather").values()) {
    if ("metric" in item && item.metric === "wind_speed" && Number.isFinite(item.value)) {
      windSum += item.value;
      windN++;
    }
  }

  let aqi = -1;
  for (const item of store.items("air").values()) {
    if ("metric" in item && item.metric === "european_aqi" && Number.isFinite(item.value)) {
      aqi = Math.max(aqi, item.value);
    }
  }

  let moving = 0;
  for (const item of store.items("ship").values()) {
    if ("speed" in item && (item.speed ?? 0) > 0.5) moving++;
  }

  return {
    bus: { count: store.items("bus").size },
    bike: { stations, availability: bikes + docks > 0 ? bikes / (bikes + docks) : 0.5 },
    sea: { tide },
    wind: { speed: windN > 0 ? windSum / windN : null },
    air: { level: aqi < 0 ? 0 : Math.min(6, Math.ceil(aqi / 20) || 1) },
    ship: { count: moving },
    plane: { count: store.items("plane").size },
  };
}
