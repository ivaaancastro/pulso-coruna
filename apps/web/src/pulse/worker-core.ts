import { PulseFetchError, fetchPulse, type FetchLike } from "./client";
import type { PulseData, PulseWindow } from "./model";

/** Mensajes hilo principal ↔ worker del índice Pulso (M7.3). */
export type PulseWorkerInput =
  { type: "fetch"; id: number; url: string; window: PulseWindow } | { type: "cancel"; id: number };

export type PulseWorkerOutput =
  | { type: "data"; id: number; data: PulseData }
  | { type: "error"; id: number; kind: "error" | "nodata" };

export interface PulseWorkerCoreOptions {
  post: (message: PulseWorkerOutput) => void;
  fetch: FetchLike;
}

/**
 * Lógica del worker (sin globales, testeable): descarga y valida con `PulseSchema` fuera del hilo
 * principal. Así zod (~28 KB gzip) no engorda el chunk diferido del mapa (presupuesto de ROADMAP).
 */
export function createPulseWorkerCore(
  opts: PulseWorkerCoreOptions,
): (message: PulseWorkerInput) => void {
  const pending = new Map<number, AbortController>();
  return (message) => {
    if (message.type === "cancel") {
      pending.get(message.id)?.abort();
      pending.delete(message.id);
      return;
    }
    const abort = new AbortController();
    pending.set(message.id, abort);
    fetchPulse(message.url, message.window, opts.fetch, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) opts.post({ type: "data", id: message.id, data });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const kind = error instanceof PulseFetchError ? error.kind : "error";
        opts.post({ type: "error", id: message.id, kind });
      })
      .finally(() => {
        if (pending.get(message.id) === abort) pending.delete(message.id);
      });
  };
}
