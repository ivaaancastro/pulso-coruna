import type { Map as MapLibreMap } from "maplibre-gl";
import { createLiveClient, type LiveClient } from "./client";
import { resolveStreamUrl } from "./config";
import { resolveHealthUrl } from "./health";
import { hasLiveLayers, loadLiveLayers } from "./layer-registry";
import { createSourceMonitor } from "./source-monitor";
import { createStatusLabel } from "./status-label";
import { createTranslator, detectLocale } from "../i18n";

export interface StartLiveOptions {
  map: MapLibreMap;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  search: string;
}

/** Lee un token numérico de `:root` (`0.35`, `600ms`); `fallback` si no existe o no se entiende. */
function cssNumber(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
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
  // Estado de las fuentes (M4.6): el pipeline atenúa las capas y la etiqueta lo cuenta.
  const monitor = createSourceMonitor({
    store: client.store,
    layers: [...new Set(definitions.flatMap((d) => d.sources))],
    now: opts.now,
    healthUrl: resolveHealthUrl(url),
  });
  const locale = detectLocale(opts.search, navigator.languages);
  const label = createStatusLabel({
    parent: document.querySelector<HTMLElement>(".shell__top") ?? document.body,
    t: createTranslator(locale),
    locale,
    now: opts.now,
    monitor,
  });
  const overlay = attachLiveOverlay({
    map: opts.map,
    store: client.store,
    definitions,
    now: opts.now,
    reducedMotion: () => motion.matches,
    monitor,
    mutedOpacity: cssNumber("--pulso-layer-muted-opacity", 0.35),
    fadeMs: cssNumber("--pulso-dur-slow", 600),
  });
  monitor.start();
  client.start();

  if (import.meta.env.DEV) {
    (window as unknown as { __pulsoLive?: LiveClient }).__pulsoLive = client;
  }
  return {
    client,
    destroy() {
      monitor.stop();
      label.destroy();
      client.stop();
      overlay.destroy();
    },
  };
}
