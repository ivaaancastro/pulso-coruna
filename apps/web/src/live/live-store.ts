import type { LayerId, LayerItem } from "@pulso/schema";
import { LayerStore } from "./store";
import type { ConnectionState, LayerFreshness, MobileFrame, WorkerOutput } from "./types";

/** Fotograma en el hilo principal: `ids` siempre presente (se conserva el último recibido). */
export interface LiveFrame extends MobileFrame {
  ids: string[];
}

export type LiveChange =
  | { kind: "items"; layer: LayerId }
  | { kind: "frames"; layers: LayerId[] }
  | { kind: "connection" };

export interface ConnectionInfo {
  state: ConnectionState;
  /** Reintentos consecutivos desde la última conexión con datos. */
  attempt: number;
}

/** Vista de solo lectura que reciben las capas deck.gl. */
export interface LiveStoreReader {
  readonly connection: ConnectionInfo;
  items(layer: LayerId): ReadonlyMap<string, LayerItem>;
  /** Posiciones interpoladas de una capa de móviles (`undefined` si aún no hay fotograma). */
  frame(layer: LayerId): LiveFrame | undefined;
  /** Última actualización de la capa (para «sin datos desde hace X min»). */
  freshness(layer: LayerId): LayerFreshness | undefined;
}

/** Espejo en el hilo principal de lo que publica el worker. */
export class LiveStore implements LiveStoreReader {
  connection: ConnectionInfo = { state: "idle", attempt: 0 };
  /** Mensajes rechazados por la validación desde que arrancó (diagnóstico). */
  rejected = 0;
  private readonly store = new LayerStore();
  private readonly frames = new Map<LayerId, LiveFrame>();
  private readonly listeners = new Set<(change: LiveChange) => void>();

  items(layer: LayerId): ReadonlyMap<string, LayerItem> {
    return this.store.get(layer);
  }

  frame(layer: LayerId): LiveFrame | undefined {
    return this.frames.get(layer);
  }

  freshness(layer: LayerId): LayerFreshness | undefined {
    return this.store.freshness(layer);
  }

  subscribe(listener: (change: LiveChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Aplica una salida del worker. */
  apply(out: WorkerOutput): void {
    switch (out.type) {
      case "status":
        this.connection = { state: out.state, attempt: out.attempt };
        this.emit({ kind: "connection" });
        return;
      case "rejected":
        this.rejected = out.total;
        return;
      case "items":
        if (out.replace) this.store.replace(out.layer, out.upserts, out.receivedAt);
        else this.store.apply(out.layer, out.upserts, out.removes, out.receivedAt);
        this.emit({ kind: "items", layer: out.layer });
        return;
      case "frames": {
        if (out.frames.length === 0) return;
        for (const f of out.frames) {
          const ids = f.ids ?? this.frames.get(f.layer)?.ids ?? [];
          this.frames.set(f.layer, { ...f, ids });
        }
        this.emit({ kind: "frames", layers: out.frames.map((f) => f.layer) });
        return;
      }
    }
  }

  private emit(change: LiveChange): void {
    for (const l of this.listeners) l(change);
  }
}
