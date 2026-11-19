/**
 * Puntos de aire. `Observation` no lleva coordenadas, así que se resuelven aquí por `stationId`.
 * Un punto fuera de la tabla se ignora: no se inventa su posición. El sufijo `:model` marca que el
 * dato es de modelo (Open-Meteo/CAMS, celda de ~0,4°), no una medición (docs/specs/M5.1b).
 */
export interface AirStation {
  name: string;
  lon: number;
  lat: number;
}

const REAL: Record<string, AirStation> = {
  "openmeteo:coruna:model": { name: "A Coruña (modelo CAMS)", lon: -8.4115, lat: 43.3623 },
};

/** Punto del simulador de desarrollo (`live/dev/mock-sim.ts`): no existe en producción. */
const MOCK: Record<string, AirStation> = {
  "mock:coruna:model": { name: "A Coruña (simulado)", lon: -8.4115, lat: 43.3623 },
};

export const AIR_STATIONS: Readonly<Record<string, AirStation>> = import.meta.env.DEV
  ? { ...REAL, ...MOCK }
  : REAL;

/** ¿El `stationId` es de modelo y no de medición? */
export function isModelStation(stationId: string): boolean {
  return stationId.endsWith(":model");
}
