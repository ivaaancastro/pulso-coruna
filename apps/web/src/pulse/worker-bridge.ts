import { PulseFetchError } from "./errors";
import type { PulseData, PulseWindow } from "./model";
import type { PulseWorkerInput, PulseWorkerOutput } from "./worker-core";

export interface PulseWorkerLike {
  postMessage(message: PulseWorkerInput): void;
  onmessage: ((event: MessageEvent<PulseWorkerOutput>) => void) | null;
  terminate(): void;
}

export interface PulseWorkerFetcher {
  fetchWindow(url: string, w: PulseWindow, signal: AbortSignal): Promise<PulseData>;
  destroy(): void;
}

/** Lado del hilo principal: `fetchWindow` del controlador, resuelto por el worker. */
export function createPulseWorkerFetcher(worker: PulseWorkerLike): PulseWorkerFetcher {
  let seq = 0;
  const waiting = new Map<
    number,
    { resolve: (d: PulseData) => void; reject: (e: unknown) => void }
  >();
  worker.onmessage = (event) => {
    const m = event.data;
    const slot = waiting.get(m.id);
    if (!slot) return;
    waiting.delete(m.id);
    if (m.type === "data") slot.resolve(m.data);
    else slot.reject(new PulseFetchError("fallo en el worker del índice", m.kind));
  };
  return {
    fetchWindow(url, w, signal) {
      return new Promise<PulseData>((resolve, reject) => {
        const id = ++seq;
        const abort = (): void => {
          if (!waiting.delete(id)) return;
          worker.postMessage({ type: "cancel", id });
          reject(new DOMException("abortado", "AbortError"));
        };
        if (signal.aborted) return abort();
        waiting.set(id, {
          resolve: (d) => {
            signal.removeEventListener("abort", abort);
            resolve(d);
          },
          reject: (e) => {
            signal.removeEventListener("abort", abort);
            reject(e);
          },
        });
        signal.addEventListener("abort", abort, { once: true });
        worker.postMessage({ type: "fetch", id, url, window: w });
      });
    },
    destroy() {
      worker.terminate();
      for (const slot of waiting.values()) slot.reject(new DOMException("abortado", "AbortError"));
      waiting.clear();
    },
  };
}
