/* global URL, Buffer, setInterval, clearInterval */
import { createHash } from "node:crypto";
import { encode } from "@msgpack/msgpack";
import { MOCK_PULSE_PATH, handleMockPulse } from "../src/live/dev/mock-pulse.ts";
import { MOCK_REPLAY_PATH, handleMockReplay } from "../src/live/dev/mock-replay.ts";
import { MockWorld } from "../src/live/dev/mock-sim.ts";
import { CLOSE_FRAME, PONG_FRAME, encodeTextFrame, frameOpcode } from "../src/live/dev/ws-frame.ts";

const STREAM_PATH = "/api/v1/stream";
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Servidor WebSocket simulado SOLO PARA DESARROLLO en /api/v1/stream del servidor de Vite.
 * Se activa con `enabled: true` (script `pnpm --filter @pulso/web dev:mock`, que fija
 * PULSO_MOCK_LIVE=1). `apply: "serve"` lo excluye del build: ni el plugin ni el simulador
 * llegan a `dist/`. Emite el contrato real (`snapshot` al conectar y `delta` después). También
 * sirve `GET /api/v1/replay` (histórico simulado en MessagePack, M6.3) y `GET /api/v1/pulse`
 * (índice Pulso simulado en JSON, M7.3) coherentes con ese mundo.
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
      server.middlewares.use(MOCK_REPLAY_PATH, (req, res, next) => {
        if (req.method !== "GET") return next();
        const url = new URL(req.url ?? "", "http://localhost");
        const reply = handleMockReplay(url.searchParams, { now: Date.now(), buses });
        for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value);
        res.statusCode = reply.status;
        if (reply.window) {
          res.end(Buffer.from(encode(reply.window)));
        } else {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(reply.error));
        }
      });
      server.middlewares.use(MOCK_PULSE_PATH, (req, res, next) => {
        if (req.method !== "GET") return next();
        const url = new URL(req.url ?? "", "http://localhost");
        const reply = handleMockPulse(url.searchParams, { now: Date.now() });
        for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value);
        res.statusCode = reply.status;
        res.end(JSON.stringify(reply.body));
      });
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
