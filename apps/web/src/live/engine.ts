import {
  LAYER_IDS,
  MOBILE_LAYER_IDS,
  type Entity,
  type LayerId,
  type LayerItem,
  type WsMessage,
} from "@pulso/schema";
import { Interpolator, type InterpolatorOptions } from "./interpolation";
import { LayerStore } from "./store";
import type { ItemsEvent, MobileFrame } from "./types";

const MOBILE = new Set<string>(MOBILE_LAYER_IDS);

/**
 * Estado del worker: almacén por capa + interpolación de las capas de móviles. Puro (sin APIs de
 * worker ni de red) para poder probarlo y medirlo en Node.
 */
export class LiveEngine {
  readonly store = new LayerStore();
  private readonly tracks = new Map<LayerId, Interpolator>();
  private readonly sentVersion = new Map<LayerId, number>();
  private reducedMotion: boolean;
  private readonly options: InterpolatorOptions;

  constructor(options: InterpolatorOptions = {}) {
    this.options = options;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    for (const track of this.tracks.values()) track.setReducedMotion(value);
  }

  /** Aplica un mensaje ya validado. `now` es el reloj de la app al recibirlo. */
  handle(message: WsMessage, now: number): ItemsEvent[] {
    if (message.type === "snapshot") {
      const events: ItemsEvent[] = [];
      // Un snapshot es el estado completo: las capas que no vienen quedan vacías (su frescura no
      // se toca, así M4.6 sabe cuánto hace que no llegan datos).
      for (const layer of LAYER_IDS) {
        const items = message.layers[layer];
        if (!items) {
          if (this.store.get(layer).size > 0) {
            this.store.clear(layer);
            this.tracks.get(layer)?.retainOnly(new Set());
            events.push(this.event(layer, true, [], [], now));
          }
          continue;
        }
        // El almacén devuelve lo que queda (un snapshot atrasado no hace retroceder elementos).
        const kept = this.store.replace(layer, items, now);
        this.syncTracks(layer, kept, now, true);
        events.push(this.event(layer, true, kept, [], now));
      }
      return events;
    }
    const applied = this.store.apply(message.layer, message.upserts, message.removes, now);
    this.syncTracks(message.layer, applied.upserts, now, false);
    for (const id of applied.removes) this.tracks.get(message.layer)?.remove(id);
    return [this.event(message.layer, false, applied.upserts, applied.removes, now)];
  }

  /**
   * Fotogramas interpolados en `now` de las capas de móviles que lo necesitan. Con
   * reduced-motion solo hay fotograma cuando cambian los datos.
   */
  frames(now: number): MobileFrame[] {
    const out: MobileFrame[] = [];
    for (const [layer, track] of this.tracks) {
      if (!track.needsFrame()) continue;
      const b = track.fill(now);
      const changed = this.sentVersion.get(layer) !== b.idsVersion;
      this.sentVersion.set(layer, b.idsVersion);
      out.push({
        layer,
        count: b.count,
        idsVersion: b.idsVersion,
        ids: changed ? b.ids : null,
        positions: b.positions,
        headings: b.headings,
      });
    }
    return out;
  }

  private event(
    layer: LayerId,
    replace: boolean,
    upserts: LayerItem[],
    removes: string[],
    now: number,
  ): ItemsEvent {
    // La frescura sale del almacén: una capa vaciada por un snapshot conserva la suya.
    const fresh = this.store.freshness(layer);
    return {
      layer,
      replace,
      upserts,
      removes,
      receivedAt: fresh?.receivedAt ?? now,
      dataTs: fresh?.dataTs ?? 0,
    };
  }

  private syncTracks(
    layer: LayerId,
    items: readonly LayerItem[],
    now: number,
    authoritative: boolean,
  ): void {
    if (!MOBILE.has(layer)) return;
    let track = this.tracks.get(layer);
    if (!track) {
      track = new Interpolator({ ...this.options, reducedMotion: this.reducedMotion });
      this.tracks.set(layer, track);
    }
    for (const item of items) track.upsert(item as Entity, now);
    if (authoritative) track.retainOnly(new Set(items.map((i) => (i as Entity).id)));
  }
}
