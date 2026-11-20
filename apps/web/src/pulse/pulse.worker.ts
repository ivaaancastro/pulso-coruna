import {
  createPulseWorkerCore,
  type PulseWorkerInput,
  type PulseWorkerOutput,
} from "./worker-core";

/**
 * Worker del índice Pulso (M7.3): pide `/api/v1/pulse` a nuestra API y valida la respuesta con
 * `PulseSchema`. Se crea al arrancar el índice; ni el JS inicial ni el chunk del mapa cargan zod.
 */
interface WorkerScope {
  postMessage(message: PulseWorkerOutput): void;
  onmessage: ((event: MessageEvent<PulseWorkerInput>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const handle = createPulseWorkerCore({
  post: (message) => scope.postMessage(message),
  fetch: (url, init) => fetch(url, init),
});

scope.onmessage = (event) => handle(event.data);
