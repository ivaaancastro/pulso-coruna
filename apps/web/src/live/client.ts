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

export interface LiveClientOptions {
  worker: WorkerLike;
  url: string;
  /** Reloj de la app (`time/now.ts`), epoch ms UTC. */
  now: () => number;
  motion: MotionQueryLike;
  /** Planificador de fotogramas (rAF); devuelve cómo cancelar. */
  raf?: (cb: () => void) => () => void;
  /** Cadencia de los ticks con reduced-motion (solo hay fotograma si cambian los datos). */
  reducedTickMs?: number;
}

export interface LiveClient {
  store: LiveStore;
  start(): void;
  stop(): void;
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

  const reduced = (): boolean => opts.motion.matches;

  const tick = (): void => {
    cancel = null;
    timer = null;
    if (!running) return;
    if (!pending) {
      pending = true;
      opts.worker.postMessage({ type: "tick", now: opts.now() });
    }
    schedule();
  };

  const schedule = (): void => {
    if (!running) return;
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

  opts.worker.onmessage = (event) => {
    const out = event.data;
    if (out.type === "frames") pending = false;
    store.apply(out);
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
      schedule();
    },
    stop() {
      if (!running) return;
      running = false;
      opts.motion.removeEventListener("change", onMotionChange);
      if (cancel) cancel();
      if (timer) clearTimeout(timer);
      cancel = timer = null;
      opts.worker.postMessage({ type: "close" });
      opts.worker.terminate();
    },
  };
}
