import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LayerPipeline } from "./layer-pipeline";
import type { LiveLayerDefinition } from "./layer-registry";
import type { LiveStore } from "./live-store";

/**
 * Este módulo es el chunk diferido de deck.gl: solo se importa dinámicamente y solo si hay capas
 * en vivo registradas (ADR-0007: `MapLibreOverlay`, canvas propio, `interleaved: false`).
 */
export interface LiveOverlayOptions {
  map: MapLibreMap;
  store: LiveStore;
  definitions: readonly LiveLayerDefinition[];
  now: () => number;
  reducedMotion: () => boolean;
  /** Planificador (rAF por defecto). */
  schedule?: (cb: () => void) => void;
}

export interface LiveOverlay {
  overlay: MapLibreOverlay;
  destroy(): void;
}

export function attachLiveOverlay(opts: LiveOverlayOptions): LiveOverlay {
  const schedule = opts.schedule ?? ((cb) => void requestAnimationFrame(cb));
  const overlay = new MapLibreOverlay({ interleaved: false, layers: [] });
  opts.map.addControl(overlay);

  const pipeline = new LayerPipeline({
    definitions: opts.definitions,
    store: opts.store,
    now: opts.now,
    reducedMotion: opts.reducedMotion,
    onError: (id, error) => console.error(`[live] la capa ${id} falló`, error),
  });
  const animated = opts.definitions.some((d) => d.animated);

  let queued = false;
  let alive = true;
  const request = (): void => {
    if (queued || !alive) return;
    queued = true;
    schedule(flush);
  };
  const flush = (): void => {
    queued = false;
    if (!alive) return;
    overlay.setProps({ layers: pipeline.collect() });
    // Capas animadas: un fotograma tras otro, salvo con reduced-motion (ahí solo cuando cambian los datos).
    if (animated && !opts.reducedMotion()) request();
  };

  const unsubscribe = opts.store.subscribe((change) => {
    if (pipeline.notify(change)) request();
  });
  request();

  return {
    overlay,
    destroy() {
      alive = false;
      unsubscribe();
      opts.map.removeControl(overlay);
    },
  };
}
