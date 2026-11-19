import { serializeShareState, type ShareState } from "./url-state";

export const CAMERA_DEBOUNCE_MS = 400;
/** Sondeo del instante reproducido: como mucho una escritura por segundo, nunca por fotograma. */
export const POLL_MS = 1000;

export interface UrlSyncOptions {
  /** Estado actual a reflejar (`null`: nada que escribir todavía). */
  read(): ShareState | null;
  location: Pick<Location, "pathname" | "search" | "hash">;
  history: Pick<History, "replaceState" | "state">;
  debounceMs?: number;
  pollMs?: number;
  /** Pestaña oculta: no se sondea. */
  hidden?: () => boolean;
}

export interface UrlSync {
  /** Cambio puntual (cámara, modo…): escribe tras `debounceMs` sin actividad. */
  request(): void;
  /** Escribe ya (al ocultarse la pestaña). */
  flush(): void;
  start(): void;
  stop(): void;
}

/**
 * Refleja el estado en el hash con `history.replaceState`: no añade entradas al historial, solo
 * escribe si el hash cambió y nunca más de ~1/s. Los cambios de cámara van con debounce; el instante
 * de Reproducir (que cambia sin eventos) se sondea cada segundo y solo escribe si su texto cambió
 * (a 1× eso es una vez por minuto; pausado, nada).
 */
export function createUrlSync(opts: UrlSyncOptions): UrlSync {
  const debounceMs = opts.debounceMs ?? CAMERA_DEBOUNCE_MS;
  const pollMs = opts.pollMs ?? POLL_MS;
  const hidden = opts.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  let last = opts.location.hash;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  function write(): void {
    const state = opts.read();
    if (!state) return;
    const hash = serializeShareState(state);
    if (hash === last) return;
    try {
      opts.history.replaceState(
        opts.history.state,
        "",
        `${opts.location.pathname}${opts.location.search}${hash}`,
      );
      last = hash;
    } catch {
      // Safari limita las llamadas a replaceState; perder una escritura no es grave.
    }
  }

  return {
    request() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        write();
      }, debounceMs);
    },
    flush() {
      if (debounce) clearTimeout(debounce);
      debounce = null;
      write();
    },
    start() {
      if (poll) return;
      poll = setInterval(() => {
        if (!hidden()) write();
      }, pollMs);
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      debounce = poll = null;
    },
  };
}
