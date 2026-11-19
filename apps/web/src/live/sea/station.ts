/**
 * Mareógrafo. `Observation` no lleva coordenadas, así que se resuelven aquí por `stationId`.
 * Las coordenadas del mareógrafo 3219 no están documentadas: se usa el puerto de A Coruña
 * (Portus, ubicación 12130, `docs/sources/portus.md`). Pendiente de verificar (docs/specs/M5.2a).
 */
export interface SeaStation {
  stationId: string;
  name: string;
  lon: number;
  lat: number;
}

export const SEA_STATION: SeaStation = {
  stationId: "portus:3219",
  name: "A Coruña",
  lon: -8.374,
  lat: 43.359,
};

/** Métrica del nivel del mar (`docs/specs/M5.1a-adaptador-mar.md`). */
export const TIDE_METRIC = "tide_level";

/**
 * Dónde se dibuja la lámina de agua: la ensenada del Orzán, que entra en el encuadre por defecto
 * (el mareógrafo queda ~2,4 km al este, fuera de pantalla). Es una elección visual: el nivel del
 * mar es el mismo, pero el halo no marca la posición del mareógrafo.
 */
export const SEA_HALO_ANCHOR: readonly [number, number] = [-8.4125, 43.3745];
