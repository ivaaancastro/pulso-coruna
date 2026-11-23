import type { Map as MapLibreMap } from "maplibre-gl";
import { createLiveClient, type LiveClient } from "./client";
import { resolveStreamUrl } from "./config";
import { resolveHealthUrl } from "./health";
import { parsePerfOverride, startAutoQuality, type AutoQuality } from "./quality/auto-quality";
import type { LiveOverlay } from "./deck";
import { hasLiveLayers, loadLiveLayers } from "./layer-registry";
import { createSourceMonitor, type SourceMonitor } from "./source-monitor";
import { SwitchableStore } from "./switchable-store";
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
  /** Lo que ven las capas: el almacén en vivo, o el de reproducción mientras dura ese modo. */
  view: SwitchableStore;
  monitor: SourceMonitor;
  /** URL del WebSocket de nuestra API (de ella se deriva la del histórico). */
  streamUrl: string;
  /** Lienzo y fotogramas de deck.gl, para el clip (M8.5). */
  deck: Pick<LiveOverlay, "canvas" | "onFrame">;
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
  // Lo que ven las capas y el monitor: el almacén en vivo, o el del histórico en Reproducir (M6.3).
  const view = new SwitchableStore(client.store);
  // Estado de las fuentes (M4.6): el pipeline atenúa las capas y la etiqueta lo cuenta.
  const monitor = createSourceMonitor({
    store: view,
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
    store: view,
    definitions,
    now: opts.now,
    reducedMotion: () => motion.matches,
    monitor,
    mutedOpacity: cssNumber("--pulso-layer-muted-opacity", 0.35),
    fadeMs: cssNumber("--pulso-dur-slow", 600),
  });
  monitor.start();
  client.start();

  const dev = import.meta.env.DEV;
  const quality = startAutoQuality({
    definitions,
    motion,
    forced: dev ? parsePerfOverride(opts.search) : null,
    onChange: (level, fps) => {
      window.dispatchEvent(new CustomEvent("pulso:quality", { detail: { level, fps } }));
      if (dev) console.debug(`[live] calidad ${level} (${Math.round(fps)} fps)`);
    },
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __pulsoLive?: LiveClient }).__pulsoLive = client;
    (window as unknown as { __pulsoQuality?: AutoQuality }).__pulsoQuality = quality;
  }
  return {
    client,
    view,
    monitor,
    streamUrl: url,
    deck: overlay,
    destroy() {
      monitor.stop();
      label.destroy();
      quality.destroy();
      if (dev) delete (window as unknown as { __pulsoQuality?: AutoQuality }).__pulsoQuality;
      client.stop();
      overlay.destroy();
    },
  };
}
