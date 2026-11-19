import { createTranslator, detectLocale } from "../i18n";
import { resolveReplayUrl } from "../live/config";
import type { WorkerLike } from "../live/client";
import type { LiveHandle } from "../live/start";
import { createReplayController, type ReplayController } from "./controller";

export interface StartReplayOptions {
  live: Pick<LiveHandle, "client" | "view" | "streamUrl">;
  /** Reloj «base» de la app (sin el override de Reproducir). */
  baseNow: () => number;
  /** Escribe la hora grande (`components/clock.ts`). */
  showTime: (ms: number) => void;
  refreshPalette: () => void;
  host: HTMLElement;
  before?: Node | null;
  search: string;
}

/**
 * Chunk diferido del modo Reproducir (M6.3): solo se descarga al elegirlo por primera vez. Crea el
 * controlador (reloj, barra de tiempo y el worker que descarga el histórico de nuestra API).
 * `null` si no hay forma de llegar a la API del histórico.
 */
export function startReplay(opts: StartReplayOptions): ReplayController | null {
  const replayUrl = resolveReplayUrl(opts.live.streamUrl);
  if (!replayUrl) return null;
  const locale = detectLocale(opts.search, navigator.languages);
  const controller = createReplayController({
    live: opts.live,
    replayUrl,
    baseNow: opts.baseNow,
    showTime: opts.showTime,
    refreshPalette: opts.refreshPalette,
    host: opts.host,
    before: opts.before,
    t: createTranslator(locale),
    locale,
    motion: window.matchMedia("(prefers-reduced-motion: reduce)"),
    createWorker: () =>
      new Worker(new URL("./replay.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as WorkerLike,
  });
  if (import.meta.env.DEV) {
    (window as unknown as { __pulsoReplay?: ReplayController }).__pulsoReplay = controller;
  }
  return controller;
}
