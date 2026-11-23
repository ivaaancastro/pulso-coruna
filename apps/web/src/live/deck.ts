import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { watchDeckCanvas } from "./deck-a11y";
import { LayerPipeline } from "./layer-pipeline";
import type { LiveLayerDefinition } from "./layer-registry";
import type { StoreSource } from "./switchable-store";
import type { SourceMonitor } from "./source-monitor";

/**
 * Este módulo es el chunk diferido de deck.gl: solo se importa dinámicamente y solo si hay capas
 * en vivo registradas (ADR-0007: `MapLibreOverlay`, canvas propio, `interleaved: false`).
 */
export interface LiveOverlayOptions {
  map: MapLibreMap;
  /** Lo que se dibuja: el almacén en vivo o, en Reproducir, el del histórico (`SwitchableStore`). */
  store: StoreSource;
  definitions: readonly LiveLayerDefinition[];
  now: () => number;
  reducedMotion: () => boolean;
  /** Estado de las fuentes (M4.6): atenúa las capas sin dato o con la conexión caída. */
  monitor?: SourceMonitor;
  /** `--pulso-layer-muted-opacity`. */
  mutedOpacity?: number;
  /** Duración del fundido, ms (`--pulso-dur-slow`). */
  fadeMs?: number;
  /** Planificador (rAF por defecto). */
  schedule?: (cb: () => void) => void;
}

export interface LiveOverlay {
  overlay: MapLibreOverlay;
  /** Lienzo de deck.gl (`null` si aún no existe). Lo usa el clip (M8.5) para copiarlo. */
  canvas(): HTMLCanvasElement | null;
  /** Se llama justo después de cada fotograma de deck.gl (el búfer aún es legible). Devuelve la baja. */
  onFrame(cb: () => void): () => void;
  destroy(): void;
}

export function attachLiveOverlay(opts: LiveOverlayOptions): LiveOverlay {
  const schedule = opts.schedule ?? ((cb) => void requestAnimationFrame(cb));
  const frameListeners = new Set<() => void>();
  const overlay = new MapLibreOverlay({
    interleaved: false,
    layers: [],
    onAfterRender: () => {
      for (const cb of frameListeners) cb();
    },
  });
  opts.map.addControl(overlay);
  const stopWatching = watchDeckCanvas(opts.map.getContainer());

  const pipeline = new LayerPipeline({
    definitions: opts.definitions,
    store: opts.store,
    now: opts.now,
    reducedMotion: opts.reducedMotion,
    onError: (id, error) => console.error(`[live] la capa ${id} falló`, error),
    onInvalidate: () => request(),
    status: opts.monitor ? (d) => opts.monitor?.stateOf(d.sources) ?? "live" : undefined,
    mutedOpacity: opts.mutedOpacity,
    fadeMs: opts.fadeMs,
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
    if ((animated && !opts.reducedMotion()) || pipeline.isFading) request();
  };

  const unsubscribe = opts.store.subscribe((change) => {
    if (pipeline.notify(change)) request();
  });
  const unsubscribeStatus = opts.monitor?.subscribe(() => {
    pipeline.touch();
    request();
  });
  request();

  return {
    overlay,
    canvas: () => overlay.getCanvas(),
    onFrame(cb) {
      frameListeners.add(cb);
      return () => void frameListeners.delete(cb);
    },
    destroy() {
      stopWatching();
      alive = false;
      unsubscribe();
      unsubscribeStatus?.();
      opts.map.removeControl(overlay);
    },
  };
}
