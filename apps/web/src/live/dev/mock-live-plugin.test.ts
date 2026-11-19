import { describe, expect, it } from "vitest";
import { mockLivePlugin } from "../../../vite/mock-live-plugin.mjs";

type Handler = (...args: unknown[]) => void;

function fakeSocket() {
  const writes: (string | Uint8Array)[] = [];
  const handlers = new Map<string, Handler>();
  return {
    writes,
    handlers,
    write: (d: string | Uint8Array) => writes.push(d),
    on: (e: string, h: Handler) => void handlers.set(e, h),
    end: () => writes.push("END"),
    destroy: () => writes.push("DESTROY"),
  };
}

function boot(options: Parameters<typeof mockLivePlugin>[0]) {
  const plugin = mockLivePlugin(options);
  const listeners = new Map<string, Handler>();
  (plugin.configureServer as (s: unknown) => void)({
    httpServer: { on: (e: string, h: Handler) => void listeners.set(e, h) },
    config: { logger: { info() {} } },
  });
  return { plugin, upgrade: listeners.get("upgrade") };
}

describe("plugin del stream simulado", () => {
  it("solo actúa en serve (nunca en build)", () => {
    expect(mockLivePlugin({ enabled: true }).apply).toBe("serve");
  });

  it("desactivado por defecto: no engancha el servidor", () => {
    expect(boot(undefined).upgrade).toBeUndefined();
  });

  it("activado: apretón WebSocket correcto y snapshot válido al conectar", () => {
    const { upgrade } = boot({ enabled: true, buses: 3, tickMs: 60_000 });
    const sock = fakeSocket();
    upgrade?.(
      {
        url: "/api/v1/stream",
        headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
      },
      sock,
    );
    expect(String(sock.writes[0])).toContain("101 Switching Protocols");
    expect(String(sock.writes[0])).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    const frame = sock.writes[1] as Uint8Array;
    const len = frame[1] === 126 ? ((frame[2] as number) << 8) | (frame[3] as number) : 0;
    const start = frame[1] === 126 ? 4 : 2;
    const json = JSON.parse(new TextDecoder().decode(frame.subarray(start, start + len))) as {
      type: string;
      layers: { bus: unknown[] };
    };
    expect(json.type).toBe("snapshot");
    expect(json.layers.bus).toHaveLength(3);
    sock.handlers.get("close")?.(); // detiene el temporizador
  });

  it("ignora otras rutas (el HMR de Vite sigue funcionando)", () => {
    const { upgrade } = boot({ enabled: true });
    const sock = fakeSocket();
    upgrade?.({ url: "/", headers: {} }, sock);
    expect(sock.writes).toEqual([]);
  });
});
