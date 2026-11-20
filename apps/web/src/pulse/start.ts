import type { PulseIndex } from "../components/pulse-index";
import { createPulseController, type PulseController } from "./controller";
import { createPulseWorkerFetcher, type PulseWorkerLike } from "./worker-bridge";

export interface StartPulseOptions {
  /** `…/api/v1/pulse` (nuestra API). */
  url: string;
  /** Reloj de la app (sigue al de Reproducir). */
  now: () => number;
  view: PulseIndex;
  /** Doble del worker en tests. */
  createWorker?: () => PulseWorkerLike;
}

/**
 * Chunk diferido: conecta el índice con la API. La petición y la validación (`PulseSchema`, que
 * trae zod) viven en `pulse.worker.ts`, fuera del hilo principal y fuera del presupuesto del mapa.
 * Pide las últimas 24 h cada 5 min, solo con la pestaña visible.
 */
export function startPulse(opts: StartPulseOptions): PulseController {
  const worker =
    opts.createWorker?.() ??
    (new Worker(new URL("./pulse.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as PulseWorkerLike);
  const fetcher = createPulseWorkerFetcher(worker);
  const controller = createPulseController({
    url: opts.url,
    now: opts.now,
    render: opts.view.render,
    fetchWindow: fetcher.fetchWindow,
    visibility: {
      hidden: () => document.visibilityState === "hidden",
      subscribe: (cb) => {
        document.addEventListener("visibilitychange", cb);
        return () => document.removeEventListener("visibilitychange", cb);
      },
    },
  });
  controller.start();
  const destroy = controller.destroy.bind(controller);
  controller.destroy = () => {
    destroy();
    fetcher.destroy();
  };
  return controller;
}
