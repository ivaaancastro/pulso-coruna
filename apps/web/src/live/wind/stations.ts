/**
 * Estaciones con viento. `Observation` no lleva coordenadas, así que se resuelven aquí por
 * `stationId` (coordenadas de `docs/sources/meteogalicia.md`). Una estación que no esté en la tabla
 * se ignora: no se inventa su posición.
 */
export interface WindStation {
  name: string;
  lon: number;
  lat: number;
}

const REAL: Record<string, WindStation> = {
  "14000": { name: "Coruña-Dique", lon: -8.374706, lat: 43.36506 },
  "14003": { name: "Punta Langosteira", lon: -8.531179, lat: 43.34723 },
};

/** Estaciones del simulador de desarrollo (`live/dev/mock-sim.ts`): no existen en producción. */
const MOCK: Record<string, WindStation> = {
  "mock-w1": { name: "Simulada 1", lon: -8.378, lat: 43.366 },
  "mock-w2": { name: "Simulada 2", lon: -8.428, lat: 43.358 },
  "mock-w3": { name: "Simulada 3", lon: -8.405, lat: 43.397 },
};

export const WIND_STATIONS: Readonly<Record<string, WindStation>> = import.meta.env.DEV
  ? { ...REAL, ...MOCK }
  : REAL;
