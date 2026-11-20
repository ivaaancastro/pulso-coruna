import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
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
  destroy(): void;
}

/**
 * El canvas de deck.gl es decorativo para la accesibilidad (los objetos solo se eligen con puntero):
 * sin nombre ni rol y con `tabindex=0` sería una parada de teclado vacía. El teclado usa el mapa
 * (MapLibre) y los botones del shell.
 */
export function hideDeckCanvas(container: ParentNode): boolean {
  const canvases = container.querySelectorAll<HTMLCanvasElement>(".deck-widget-container canvas");
  for (const canvas of canvases) {
    canvas.tabIndex = -1;
    canvas.setAttribute("aria-hidden", "true");
  }
  return canvases.length > 0;
}

export function attachLiveOverlay(opts: LiveOverlayOptions): LiveOverlay {
  const schedule = opts.schedule ?? ((cb) => void requestAnimationFrame(cb));
  const overlay = new MapLibreOverlay({ interleaved: false, layers: [] });
  opts.map.addControl(overlay);
  const container = opts.map.getContainer();
  let canvasHidden = hideDeckCanvas(container);

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
    if (!canvasHidden) canvasHidden = hideDeckCanvas(container);
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
    destroy() {
      alive = false;
      unsubscribe();
      unsubscribeStatus?.();
      opts.map.removeControl(overlay);
    },
  };
}
