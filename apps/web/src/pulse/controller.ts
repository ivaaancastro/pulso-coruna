import {
  deriveSnapshot,
  pulseWindow,
  type PulseData,
  type PulseFailure,
  type PulseSnapshot,
  type PulseWindow,
} from "./model";

/** Espera tras cambiar de ventana antes de pedir (arrastrar la línea temporal en Reproducir). */
export const WINDOW_DEBOUNCE_MS = 400;
/** Reintento tras un fallo de la misma ventana. */
export const RETRY_MS = 30_000;
/** Cadencia con la que se relee el reloj (el valor depende de la hora, también en Reproducir). */
export const TICK_MS = 1000;

export interface PulseControllerOptions {
  /** URL de `/api/v1/pulse` (nuestra API). */
  url: string;
  /** Reloj de la app: en Reproducir, el reproducido (`time/now.ts`). */
  now: () => number;
  render: (snapshot: PulseSnapshot) => void;
  fetchWindow: (url: string, w: PulseWindow, signal: AbortSignal) => Promise<PulseData>;
  visibility: { hidden: () => boolean; subscribe: (cb: () => void) => () => void };
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface PulseController {
  start(): void;
  /** Relee reloj y estado; pide datos si la ventana cambió. */
  sync(): void;
  destroy(): void;
}

/**
 * Mantiene la serie de las últimas 24 h: una petición por ventana (paso de 5 min, así el refresco
 * del directo es una petición cada 5 min y todos los clientes comparten caché), solo con la pestaña
 * visible, con antirrebote al mover el reloj de Reproducir y reintento tras un fallo.
 */
export function createPulseController(opts: PulseControllerOptions): PulseController {
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let data: PulseData | null = null;
  let failure: { to: number; kind: PulseFailure; at: number } | null = null;
  let inFlight: { to: number; abort: AbortController } | null = null;
  let pending: { to: number; timer: unknown } | null = null;
  let tick: unknown = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;

  const load = (w: PulseWindow): void => {
    inFlight?.abort.abort();
    const abort = new AbortController();
    inFlight = { to: w.to, abort };
    opts
      .fetchWindow(opts.url, w, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        data = result;
        failure = null;
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const kind = (error as { kind?: PulseFailure }).kind === "nodata" ? "nodata" : "error";
        failure = { to: w.to, kind, at: opts.now() };
      })
      .finally(() => {
        if (inFlight?.abort === abort) inFlight = null;
        if (!abort.signal.aborted) sync();
      });
  };

  function sync(): void {
    if (!running) return;
    const t = opts.now();
    const w = pulseWindow(t);
    const failed = failure?.to === w.to ? failure : null;
    const have = data?.to === w.to;
    const retryDue = failed ? t - failed.at >= RETRY_MS : true;
    const busy = inFlight?.to === w.to;
    if (!have && !busy && retryDue && !opts.visibility.hidden() && pending?.to !== w.to) {
      if (pending) clearTimer(pending.timer);
      // La primera carga es inmediata; los cambios de ventana esperan a que el reloj se asiente.
      const delay = data || failure ? WINDOW_DEBOUNCE_MS : 0;
      const slot: { to: number; timer: unknown } = { to: w.to, timer: null };
      slot.timer = setTimer(() => {
        if (pending === slot) pending = null;
        if (pulseWindow(opts.now()).to === w.to && !opts.visibility.hidden()) load(w);
        else sync();
      }, delay);
      pending = slot;
    }
    opts.render(deriveSnapshot(data, failed?.kind ?? null, t));
  }

  const schedule = (): void => {
    if (tick !== null) return;
    const again = (): void => {
      tick = null;
      if (!running || opts.visibility.hidden()) return;
      sync();
      tick = setTimer(again, TICK_MS);
    };
    tick = setTimer(again, TICK_MS);
  };

  const unschedule = (): void => {
    if (tick !== null) clearTimer(tick);
    tick = null;
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = opts.visibility.subscribe(() => {
        if (opts.visibility.hidden()) {
          unschedule();
          inFlight?.abort.abort();
          inFlight = null;
          if (pending) clearTimer(pending.timer);
          pending = null;
        } else {
          sync();
          schedule();
        }
      });
      sync();
      if (!opts.visibility.hidden()) schedule();
    },
    sync,
    destroy() {
      running = false;
      unschedule();
      unsubscribe?.();
      inFlight?.abort.abort();
      if (pending) clearTimer(pending.timer);
      pending = null;
    },
  };
}
