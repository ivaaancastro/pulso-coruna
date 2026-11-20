import type { Map as MapLibreMap } from "maplibre-gl";
import type { Translate } from "../i18n";
import type { ReplayController } from "../replay/controller";
import "./share.css";
import { createShareButton } from "./share-button";
import { buildShareUrl, type ShareState } from "./url-state";
import { createUrlSync } from "./url-sync";

export interface StartShareOptions {
  map: MapLibreMap;
  /** Donde montar el botón (`.shell`). */
  host: HTMLElement;
  t: Translate;
  /** Estado leído del hash al abrir (ya validado). */
  initial: ShareState;
  getMode(): "view" | "replay";
  getReplay(): ReplayController | null;
  /** Entra en Reproducir con ese instante/velocidad (el modo y la carga diferida son de `main.ts`). */
  restoreReplay(state: ShareState): Promise<void>;
  location?: Location;
  history?: History;
}

export interface ShareHandle {
  /** Estado actual; con `forceCamera` incluye siempre la cámara (para el botón). */
  current(forceCamera: boolean): ShareState;
  destroy(): void;
}

/**
 * Chunk diferido de «URL compartible» (M6.4): botón de compartir y sincronía del hash. Nada de esto
 * pesa en el JS inicial. La cámara solo se escribe en la URL cuando el usuario la ha movido (o el
 * enlace ya traía una): quien abre la web sin parámetros no ve cambiar su URL con la intro, y si
 * recarga conserva la intro.
 */
export function startShare(opts: StartShareOptions): ShareHandle {
  const loc = opts.location ?? window.location;
  const hist = opts.history ?? window.history;
  let userMoved = opts.initial.camera !== undefined;
  let ready = opts.initial.mode !== "replay"; // en un enlace de Reproducir, hasta restaurar no se escribe

  function current(forceCamera: boolean): ShareState {
    const state: ShareState = { mode: "view" };
    if (forceCamera || userMoved) {
      const c = opts.map.getCenter();
      state.camera = {
        lat: c.lat,
        lon: c.lng,
        zoom: opts.map.getZoom(),
        bearing: opts.map.getBearing(),
        pitch: opts.map.getPitch(),
      };
    }
    if (opts.getMode() === "replay") {
      state.mode = "replay";
      const replay = opts.getReplay();
      if (replay?.active) {
        const s = replay.getState();
        state.t = s.t;
        state.speed = s.speed;
      } else {
        // Aún cargando el modo: se conserva lo que pidió el enlace en vez de borrarlo.
        if (opts.initial.t !== undefined) state.t = opts.initial.t;
        if (opts.initial.speed !== undefined) state.speed = opts.initial.speed;
      }
    }
    return state;
  }

  const sync = createUrlSync({
    read: () => (ready ? current(false) : null),
    location: loc,
    history: hist,
  });

  const onMoveEnd = (e: { originalEvent?: unknown }): void => {
    if (e.originalEvent) userMoved = true;
    if (userMoved) sync.request();
  };
  opts.map.on("moveend", onMoveEnd);
  const onHide = (): void => {
    if (document.visibilityState === "hidden") sync.flush();
  };
  document.addEventListener("visibilitychange", onHide);

  const button = createShareButton({
    t: opts.t,
    getUrl: () => buildShareUrl(loc, current(true)),
  });
  opts.host.append(button.element);

  if (opts.initial.mode === "replay") {
    void opts
      .restoreReplay(opts.initial)
      .catch((error: unknown) => console.error("[share] restauración fallida", error))
      .finally(() => {
        ready = true;
      });
  }
  sync.start();

  return {
    current,
    destroy() {
      sync.stop();
      opts.map.off("moveend", onMoveEnd);
      document.removeEventListener("visibilitychange", onHide);
      button.element.remove();
    },
  };
}
