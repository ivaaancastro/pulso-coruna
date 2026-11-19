import { ReplayWindowSchema } from "@pulso/schema";
import type { WorkerInput, WorkerOutput } from "../live/types";
import { createWindowLoader } from "./loader";
import { createReplayWorkerCore } from "./worker-core";

/**
 * Worker de reproducción (M6.3): descarga, decodifica (MessagePack), valida e interpola las
 * ventanas del histórico fuera del hilo principal. Solo habla con nuestra API
 * (`/api/v1/replay`). Se crea al entrar en Reproducir y se termina al salir: ni el modo En vivo
 * ni el JS inicial lo cargan.
 */
interface WorkerScope {
  postMessage(message: WorkerOutput, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
}
const scope = self as unknown as WorkerScope;

/** `@msgpack/msgpack` (solo `decode`, ADR-0025) se importa al primer uso: otro chunk. */
let decoder: Promise<(bytes: Uint8Array) => unknown> | null = null;
const decode = async (bytes: Uint8Array): Promise<unknown> => {
  decoder ??= import("@msgpack/msgpack").then((m) => (b: Uint8Array) => m.decode(b));
  return (await decoder)(bytes);
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("abortado"));
      },
      { once: true },
    );
  });

const handle = createReplayWorkerCore({
  post: (message, transfer) => scope.postMessage(message, transfer),
  clock: () => performance.now(),
  createLoader: (baseUrl) =>
    createWindowLoader({
      baseUrl,
      fetch: (url, init) => fetch(url, init),
      decode,
      validate: (value) => {
        const parsed = ReplayWindowSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      },
      sleep,
    }),
});

scope.onmessage = (event) => handle(event.data);
