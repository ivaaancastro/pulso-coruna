import type { LayerId, LayerItem } from "@pulso/schema";
import type { LiveChange, LiveFrame, ConnectionInfo } from "./live-store";
import type { MonitorStore } from "./source-monitor";
import type { LayerFreshness } from "./types";

/** Un almacén del que se puede leer y al que se puede suscribir (el vivo o el de reproducción). */
export type StoreSource = MonitorStore;

/**
 * Almacén que las capas, el pipeline y el monitor de fuentes ven siempre igual, pero que lee del
 * «vivo» o del de «reproducción» según el modo (M6.3). Así las capas deck.gl existentes no se
 * duplican ni se enteran: al cambiar de modo solo cambia de dónde sale el dato, y la escena (mapa,
 * overlay, cámara) no se recarga. Al cambiar, avisa como un `reset` (todo cambió) para que
 * el pipeline y el monitor reevalúen.
 */
export class SwitchableStore implements StoreSource {
  private source: StoreSource;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(change: LiveChange) => void>();

  constructor(initial: StoreSource) {
    this.source = initial;
    this.attach();
  }

  get current(): StoreSource {
    return this.source;
  }

  /** Pasa a leer de `next`. No hace nada si ya es el actual. */
  use(next: StoreSource): void {
    if (next === this.source) return;
    this.unsubscribe?.();
    this.source = next;
    this.attach();
    this.emit({ kind: "reset" });
  }

  get connection(): ConnectionInfo {
    return this.source.connection;
  }

  items(layer: LayerId): ReadonlyMap<string, LayerItem> {
    return this.source.items(layer);
  }

  frame(layer: LayerId): LiveFrame | undefined {
    return this.source.frame(layer);
  }

  freshness(layer: LayerId): LayerFreshness | undefined {
    return this.source.freshness(layer);
  }

  subscribe(listener: (change: LiveChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private attach(): void {
    this.unsubscribe = this.source.subscribe((change) => this.emit(change));
  }

  private emit(change: LiveChange): void {
    for (const l of [...this.listeners]) l(change);
  }
}
