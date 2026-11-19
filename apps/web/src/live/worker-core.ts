import { LiveEngine } from "./engine";
import { parseWsMessage } from "./protocol";
import type { WorkerInput, WorkerOutput } from "./types";
import { createWsClient, type SocketLike, type WsClient } from "./ws-client";

export interface WorkerCoreDeps {
  /** Envía al hilo principal; `transfer` lleva los ArrayBuffer que se ceden. */
  post: (message: WorkerOutput, transfer: ArrayBuffer[]) => void;
  createSocket: (url: string) => SocketLike;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Lógica del worker sin APIs globales: recibe órdenes del hilo principal, mantiene la conexión,
 * valida, aplica al motor y devuelve elementos y fotogramas.
 */
export function createWorkerCore(deps: WorkerCoreDeps): (input: WorkerInput) => void {
  const engine = new LiveEngine();
  let client: WsClient | null = null;
  let now = 0;
  let rejected = 0;

  return (input) => {
    switch (input.type) {
      case "init": {
        now = input.now;
        engine.setReducedMotion(input.reducedMotion);
        client?.close();
        client = createWsClient({
          url: input.url,
          createSocket: deps.createSocket,
          random: deps.random,
          setTimer: deps.setTimer,
          clearTimer: deps.clearTimer,
          onState: (state, attempt) => deps.post({ type: "status", state, attempt }, []),
          onMessage: (raw) => {
            const parsed = parseWsMessage(raw);
            if (!parsed.ok) {
              rejected++;
              deps.post({ type: "rejected", total: rejected }, []);
              return;
            }
            for (const event of engine.handle(parsed.message, now)) {
              deps.post({ type: "items", ...event }, []);
            }
          },
        });
        client.connect();
        return;
      }
      case "tick": {
        now = input.now;
        const frames = engine.frames(now);
        deps.post(
          { type: "frames", frames },
          frames.flatMap((f) => [
            f.positions.buffer as ArrayBuffer,
            f.headings.buffer as ArrayBuffer,
          ]),
        );
        return;
      }
      case "reducedMotion":
        engine.setReducedMotion(input.value);
        return;
      case "close":
        client?.close();
        client = null;
        return;
    }
  };
}
