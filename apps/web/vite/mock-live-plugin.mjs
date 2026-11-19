/* global URL, setInterval, clearInterval */
import { createHash } from "node:crypto";
import { MockWorld } from "../src/live/dev/mock-sim.ts";
import { CLOSE_FRAME, PONG_FRAME, encodeTextFrame, frameOpcode } from "../src/live/dev/ws-frame.ts";

const STREAM_PATH = "/api/v1/stream";
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Servidor WebSocket simulado SOLO PARA DESARROLLO en /api/v1/stream del servidor de Vite.
 * Se activa con `enabled: true` (script `pnpm --filter @pulso/web dev:mock`, que fija
 * PULSO_MOCK_LIVE=1). `apply: "serve"` lo excluye del build: ni el plugin ni el simulador
 * llegan a `dist/`. Emite el contrato real (`snapshot` al conectar y `delta` después).
 *
 * @param {{ enabled?: boolean, buses?: number, tickMs?: number }} [options]
 * @returns {import("vite").Plugin}
 */
export function mockLivePlugin(options = {}) {
  const { enabled = false, buses = 60, tickMs = 1000 } = options;
  return {
    name: "pulso-mock-live",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return;
      const http = server.httpServer;
      if (!http) return;
      server.config.logger.info(
        "  [mock-live] stream simulado en ws:" + STREAM_PATH + " (solo desarrollo)",
      );
      http.on("upgrade", (req, socket) => {
        if (!req.url || new URL(req.url, "http://localhost").pathname !== STREAM_PATH) return;
        const key = req.headers["sec-websocket-key"];
        if (typeof key !== "string") {
          socket.destroy();
          return;
        }
        const accept = createHash("sha1")
          .update(key + GUID)
          .digest("base64");
        socket.write(
          [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${accept}`,
            "",
            "",
          ].join("\r\n"),
        );
        const world = new MockWorld({ buses });
        const send = (message) => socket.write(encodeTextFrame(JSON.stringify(message)));
        send(world.snapshot(Date.now()));
        const timer = setInterval(() => {
          for (const delta of world.step(Date.now())) send(delta);
        }, tickMs);
        const stop = () => clearInterval(timer);
        socket.on("close", stop);
        socket.on("error", stop);
        socket.on("data", (chunk) => {
          const op = frameOpcode(chunk);
          if (op === 0x9) socket.write(PONG_FRAME);
          if (op === 0x8) {
            socket.write(CLOSE_FRAME);
            socket.end();
          }
        });
      });
    },
  };
}
