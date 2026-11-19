/** Tipos compartidos entre el worker de reproducción y el hilo principal (solo tipos: sin código). */

/** Por qué no se pudo cargar una ventana. */
export type ReplayErrorKind = "network" | "server" | "rate" | "too_large" | "invalid";

/** Estado que el worker de reproducción publica cuando cambia. */
export interface ReplayStatus {
  /** La ventana del instante actual aún no está disponible (cargando o a la espera del debounce). */
  loading: boolean;
  /** Último fallo de la ventana actual; `null` si no hay. El worker reintenta solo. */
  error: ReplayErrorKind | null;
  /** La ventana actual está cargada pero no hay ningún dato (ni estado inicial) para este instante. */
  noData: boolean;
  /** Resolución de la ventana actual (`1m`: sin `meta`, una muestra por minuto). */
  resolution: "raw" | "1m" | null;
}

/** Velocidades de reproducción admitidas (múltiplos de tiempo real). */
export const SPEEDS = [1, 60, 600] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];
