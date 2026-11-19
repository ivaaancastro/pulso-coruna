import type { WorkerInput, WorkerOutput } from "./types";
import { createWorkerCore } from "./worker-core";
import type { SocketLike } from "./ws-client";

/**
 * Worker de datos en vivo: WebSocket, validación, almacén e interpolación fuera del hilo
 * principal. El proyecto compila con la lib DOM, así que el ámbito del worker se tipa a mano.
 */
interface WorkerScope {
  postMessage(message: WorkerOutput, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
}
const scope = self as unknown as WorkerScope;

function openSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: () => ws.close(),
  };
  ws.onopen = (ev) => socket.onopen?.(ev);
  ws.onmessage = (ev) => socket.onmessage?.({ data: ev.data });
  ws.onclose = (ev) => socket.onclose?.(ev);
  ws.onerror = (ev) => socket.onerror?.(ev);
  return socket;
}

const handle = createWorkerCore({
  post: (message, transfer) => scope.postMessage(message, transfer),
  createSocket: openSocket,
});

scope.onmessage = (event) => handle(event.data);
