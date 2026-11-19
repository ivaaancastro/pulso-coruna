import type { Map as MapLibreMap } from "maplibre-gl";
import { createLiveClient, type LiveClient } from "./client";
import { resolveStreamUrl } from "./config";
import { hasLiveLayers, loadLiveLayers } from "./layer-registry";

export interface StartLiveOptions {
  map: MapLibreMap;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  search: string;
}

export interface LiveHandle {
  client: LiveClient;
  destroy(): void;
}

/**
 * Arranca los datos en vivo: worker (WebSocket + interpolación) y overlay deck.gl. No hace nada
 * (ni red ni deck.gl) si el stream está desactivado o no hay capas registradas.
 */
export async function startLive(opts: StartLiveOptions): Promise<LiveHandle | null> {
  const url = resolveStreamUrl(
    {
      dev: import.meta.env.DEV,
      configured: import.meta.env.VITE_LIVE_URL as string | undefined,
    },
    opts.search,
    window.location,
  );
  if (!url || !hasLiveLayers()) return null;

  const [definitions, { attachLiveOverlay }] = await Promise.all([
    loadLiveLayers(),
    import("./deck"),
  ]);

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const client = createLiveClient({
    worker: new Worker(new URL("./live.worker.ts", import.meta.url), { type: "module" }),
    url,
    now: opts.now,
    motion,
  });
  const overlay = attachLiveOverlay({
    map: opts.map,
    store: client.store,
    definitions,
    now: opts.now,
    reducedMotion: () => motion.matches,
  });
  client.start();

  if (import.meta.env.DEV) {
    (window as unknown as { __pulsoLive?: LiveClient }).__pulsoLive = client;
  }
  return {
    client,
    destroy() {
      client.stop();
      overlay.destroy();
    },
  };
}
