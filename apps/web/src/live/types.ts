import type { LayerId, LayerItem } from "@pulso/schema";

/** Estado de la conexión WebSocket con nuestra API. */
export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** Frescura de una capa. Ambos valores en epoch ms UTC. */
export interface LayerFreshness {
  /** Cuándo llegó el último mensaje que tocó la capa (reloj de la app). */
  receivedAt: number;
  /** Mayor `ts` de dato recibido en la capa (la hora de la fuente). */
  dataTs: number;
}

/**
 * Posiciones ya interpoladas de una capa de móviles, listas para deck.gl como atributos
 * binarios (`data: { length: count, attributes: { getPosition: { value: positions, size: 2 } } }`).
 * Los buffers se transfieren desde el worker: son del hilo principal y no se reutilizan allí.
 */
export interface MobileFrame {
  layer: LayerId;
  count: number;
  /** Se incrementa cuando entra o sale alguna entidad; indica cuándo cambian `ids`. */
  idsVersion: number;
  /** Claves en el mismo orden que los buffers. `null` si no cambió desde el fotograma anterior. */
  ids: string[] | null;
  /** lon, lat intercalados (2 por entidad). */
  positions: Float32Array;
  /** Rumbo en grados [0, 360), 0 = norte (1 por entidad). */
  headings: Float32Array;
}

/** Cambio de elementos de una capa, tal como lo aplica el almacén. */
export interface ItemsEvent {
  layer: LayerId;
  /** `true`: sustituye la capa entera (snapshot). */
  replace: boolean;
  upserts: LayerItem[];
  removes: string[];
  receivedAt: number;
  dataTs: number;
}

/** Hilo principal → worker. */
export type WorkerInput =
  | { type: "init"; url: string; now: number; reducedMotion: boolean }
  | { type: "tick"; now: number }
  | { type: "reducedMotion"; value: boolean }
  | { type: "close" };

/** Worker → hilo principal. */
export type WorkerOutput =
  | { type: "status"; state: ConnectionState; attempt: number }
  | ({ type: "items" } & ItemsEvent)
  | { type: "frames"; frames: MobileFrame[] }
  | { type: "rejected"; total: number };
