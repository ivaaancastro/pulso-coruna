import { describe, expect, it } from "vitest";
import { resolveReplayUrl, resolveStreamUrl } from "./config";

const loc = { protocol: "http:", host: "localhost:5173" };
const prod = { protocol: "https:", host: "pulso.example" };

describe("resolveStreamUrl", () => {
  it("desarrollo: /api/v1/stream del propio servidor", () => {
    expect(resolveStreamUrl({ dev: true }, "", loc)).toBe("ws://localhost:5173/api/v1/stream");
  });

  it("?live=0 lo desactiva solo en desarrollo", () => {
    expect(resolveStreamUrl({ dev: true }, "?live=0", loc)).toBeNull();
    expect(resolveStreamUrl({ dev: false, configured: "/api/v1/stream" }, "?live=0", prod)).toBe(
      "wss://pulso.example/api/v1/stream",
    );
  });

  it("producción: desactivado salvo URL configurada (ruta o ws/wss absoluta)", () => {
    expect(resolveStreamUrl({ dev: false }, "", prod)).toBeNull();
    expect(resolveStreamUrl({ dev: false, configured: "  " }, "", prod)).toBeNull();
    expect(resolveStreamUrl({ dev: false, configured: "/api/v1/stream" }, "", prod)).toBe(
      "wss://pulso.example/api/v1/stream",
    );
    expect(
      resolveStreamUrl({ dev: false, configured: "wss://api.pulso.example/s" }, "", prod),
    ).toBe("wss://api.pulso.example/s");
  });

  it("rechaza valores que no son ruta ni ws(s)", () => {
    expect(resolveStreamUrl({ dev: false, configured: "https://x/y" }, "", prod)).toBeNull();
    expect(resolveStreamUrl({ dev: true, configured: "stream" }, "", loc)).toBeNull();
  });
});

describe("resolveReplayUrl", () => {
  it("deriva /api/v1/replay de la URL del stream (nuestra API)", () => {
    expect(resolveReplayUrl("ws://localhost:5173/api/v1/stream")).toBe(
      "http://localhost:5173/api/v1/replay",
    );
    expect(resolveReplayUrl("wss://pulso.example/api/v1/stream?x=1")).toBe(
      "https://pulso.example/api/v1/replay",
    );
  });

  it("null si no es un stream ws(s) o no acaba en /stream", () => {
    expect(resolveReplayUrl("https://pulso.example/api/v1/stream")).toBeNull();
    expect(resolveReplayUrl("wss://pulso.example/otra")).toBeNull();
    expect(resolveReplayUrl("no es url")).toBeNull();
  });
});
