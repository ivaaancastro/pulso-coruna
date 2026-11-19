import { LiveStore } from "./live-store";
import type { WorkerInput, WorkerOutput } from "./types";

/** Subconjunto de Worker que usamos; permite un doble en los tests. */
export interface WorkerLike {
  postMessage(message: WorkerInput): void;
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null;
  terminate(): void;
}

export interface MotionQueryLike {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/** `window`, o un doble en los tests: solo el evento `online`. */
export interface OnlineSourceLike {
  addEventListener(type: "online", listener: () => void): void;
  removeEventListener(type: "online", listener: () => void): void;
}

export interface LiveClientOptions {
  worker: WorkerLike;
  url: string;
  /** Reloj de la app (`time/now.ts`), epoch ms UTC. */
  now: () => number;
  motion: MotionQueryLike;
  /** Origen del evento `online` (por defecto `window`): fuerza una reconexión inmediata. */
  online?: OnlineSourceLike;
  /** Planificador de fotogramas (rAF); devuelve cómo cancelar. */
  raf?: (cb: () => void) => () => void;
  /** Cadencia de los ticks con reduced-motion (solo hay fotograma si cambian los datos). */
  reducedTickMs?: number;
  /** Cada salida del worker, tras aplicarla al almacén (reproducción: estado de carga). */
  onOutput?: (out: WorkerOutput) => void;
}

export interface LiveClient {
  store: LiveStore;
  start(): void;
  stop(): void;
  /**
   * `false`: deja de pedir fotogramas (modo Reproducir: el directo sigue recibiendo datos en el
   * worker pero no se dibuja). `true`: los pide de nuevo. El WebSocket no se toca.
   */
  setActive(active: boolean): void;
}

const defaultRaf = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

/**
 * Cliente del hilo principal. Un tick por fotograma con la hora de la app: el worker responde con
 * buffers ya interpolados. Si el worker aún no contestó al anterior no se envía otro, de modo que
 * el hilo principal nunca acumula trabajo.
 */
export function createLiveClient(opts: LiveClientOptions): LiveClient {
  const store = new LiveStore();
  const raf = opts.raf ?? defaultRaf;
  const reducedTickMs = opts.reducedTickMs ?? 1000;
  let cancel: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let running = false;
  let paused = false;

  const reduced = (): boolean => opts.motion.matches;

  const tick = (): void => {
    cancel = null;
    timer = null;
    if (!running || paused) return;
    if (!pending) {
      pending = true;
      opts.worker.postMessage({ type: "tick", now: opts.now() });
    }
    schedule();
  };

  const schedule = (): void => {
    if (!running || paused) return;
    if (reduced()) timer = setTimeout(tick, reducedTickMs);
    else cancel = raf(tick);
  };

  const onMotionChange = (): void => {
    opts.worker.postMessage({ type: "reducedMotion", value: reduced() });
    if (cancel) cancel();
    if (timer) clearTimeout(timer);
    cancel = null;
    timer = null;
    schedule();
  };

  const online = opts.online ?? (typeof window === "undefined" ? undefined : window);
  const onOnline = (): void => opts.worker.postMessage({ type: "online" });

  opts.worker.onmessage = (event) => {
    const out = event.data;
    if (out.type === "frames") pending = false;
    store.apply(out);
    opts.onOutput?.(out);
  };

  return {
    store,
    start() {
      if (running) return;
      running = true;
      opts.worker.postMessage({
        type: "init",
        url: opts.url,
        now: opts.now(),
        reducedMotion: reduced(),
      });
      opts.motion.addEventListener("change", onMotionChange);
      online?.addEventListener("online", onOnline);
      schedule();
    },
    setActive(active) {
      if (paused === !active) return;
      paused = !active;
      if (paused) {
        if (cancel) cancel();
        if (timer) clearTimeout(timer);
        cancel = timer = null;
      } else schedule();
    },
    stop() {
      if (!running) return;
      running = false;
      opts.motion.removeEventListener("change", onMotionChange);
      online?.removeEventListener("online", onOnline);
      if (cancel) cancel();
      if (timer) clearTimeout(timer);
      cancel = timer = null;
      opts.worker.postMessage({ type: "close" });
      opts.worker.terminate();
    },
  };
}
