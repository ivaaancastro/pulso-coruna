import { encode, decode } from "@msgpack/msgpack";
import { ReplayWindowSchema } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { REPLAY_LAYERS, createWindowLoader, retryAfterMs, type ResponseLike } from "./loader";
import { W0, emptyLayersWindow, mobileWindow } from "./test-helpers";

const res = (
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): ResponseLike => {
  const bytes = body === undefined ? new Uint8Array(0) : encode(body);
  return {
    status,
    ok: status === 200,
    headers: { get: (n) => headers[n] ?? null },
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
};

const make = (responses: (ResponseLike | Error)[], urls: string[] = [], sleeps: number[] = []) => {
  const queue = [...responses];
  return createWindowLoader({
    baseUrl: "http://api.test/api/v1/replay",
    fetch: (url) => {
      urls.push(url);
      const next = queue.shift();
      if (!next) throw new Error("sin más respuestas");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    decode,
    validate: (v) => {
      const r = ReplayWindowSchema.safeParse(v);
      return r.success ? r.data : null;
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
};

const signal = new AbortController().signal;

describe("cargador de ventanas", () => {
  it("pide una ventana alineada de 5 min a nuestra API con las capas que dibuja la web", async () => {
    const urls: string[] = [];
    const loader = make([res(200, emptyLayersWindow(W0))], urls);
    const out = await loader.load(W0, signal);
    expect(out.ok).toBe(true);
    const u = new URL(urls[0] as string);
    expect(u.origin + u.pathname).toBe("http://api.test/api/v1/replay");
    expect(u.searchParams.get("from")).toBe(String(W0));
    expect(u.searchParams.get("to")).toBe(String(W0 + 300_000));
    expect(u.searchParams.get("layers")).toBe(REPLAY_LAYERS.join(","));
    expect(Number(u.searchParams.get("from")) % 300_000).toBe(0);
  });

  it("decodifica y valida el cuerpo (con bytes medidos)", async () => {
    const w = mobileWindow(W0, "bus", [
      { id: "b", samples: [{ ts: 1000, lon: -8.4, lat: 43.37 }] },
    ]);
    const out = await make([res(200, w)]).load(W0, signal);
    expect(out.ok && out.window.layers.bus?.kind).toBe("mobile");
    expect(out.ok && out.bytes).toBeGreaterThan(10);
  });

  it("rechaza lo que no cumple el contrato o es otra ventana (invalid, sin reintentar)", async () => {
    const urls: string[] = [];
    expect(await make([res(200, { v: 2 })], urls).load(W0, signal)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await make([res(200, emptyLayersWindow(W0 + 300_000))]).load(W0, signal)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(urls).toHaveLength(1);
  });

  it("429 y 503 respetan Retry-After y reintentan; al agotarse, rate/server", async () => {
    const sleeps: number[] = [];
    const ok = await make(
      [res(429, undefined, { "Retry-After": "2" }), res(200, emptyLayersWindow(W0))],
      [],
      sleeps,
    ).load(W0, signal);
    expect(ok.ok).toBe(true);
    expect(sleeps).toEqual([2000]);

    const sleeps2: number[] = [];
    const down = await make(
      [res(503, undefined, { "Retry-After": "5" }), res(503), res(503)],
      [],
      sleeps2,
    ).load(W0, signal);
    expect(down).toEqual({ ok: false, reason: "server" });
    expect(sleeps2).toEqual([5000, 5000]); // 2.º 503 sin cabecera → 5 s por defecto

    const limited = await make([res(429), res(429), res(429)]).load(W0, signal);
    expect(limited).toEqual({ ok: false, reason: "rate" });
  });

  it("413: pide capa a capa y las funde", async () => {
    const urls: string[] = [];
    const parts = REPLAY_LAYERS.map((layer: string) => {
      if (layer === "bus")
        return res(
          200,
          mobileWindow(W0, "bus", [{ id: "b", samples: [{ ts: 0, lon: -8.4, lat: 43.37 }] }]),
        );
      return res(200, {
        v: 1,
        from: W0,
        to: W0 + 300_000,
        resolution: layer === "weather" ? "1m" : "raw",
        layers: {
          [layer]:
            layer === "bike"
              ? { kind: "station", stations: [] }
              : layer === "bus" || layer === "ship" || layer === "plane"
                ? { kind: "mobile", tracks: [] }
                : { kind: "series", series: [] },
        },
      });
    });
    const out = await make([res(413), ...parts], urls).load(W0, signal);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.window.layers).sort()).toEqual([...REPLAY_LAYERS].sort());
    expect(out.window.resolution).toBe("1m");
    expect(urls).toHaveLength(1 + REPLAY_LAYERS.length);
    expect(new URL(urls[1] as string).searchParams.get("layers")).toBe("bus");
  });

  it("413 que persiste con una sola capa → too_large", async () => {
    const out = await make([res(413), res(413)]).load(W0, signal);
    expect(out).toEqual({ ok: false, reason: "too_large" });
  });

  it("400 (fuera de rango) es una ventana vacía, no un error", async () => {
    const out = await make([res(400, { error: "bad_request" })]).load(W0, signal);
    expect(out.ok && out.window.layers).toEqual({});
  });

  it("errores de red y 5xx se distinguen; abortar no es un fallo", async () => {
    expect(await make([new TypeError("fallo")]).load(W0, signal)).toEqual({
      ok: false,
      reason: "network",
    });
    expect(await make([res(500)]).load(W0, signal)).toEqual({ ok: false, reason: "server" });
    const ac = new AbortController();
    const abort = Object.assign(new Error("abortado"), { name: "AbortError" });
    ac.abort();
    expect(await make([abort]).load(W0, ac.signal)).toEqual({ ok: false, reason: "aborted" });
  });
});

describe("retryAfterMs", () => {
  it("segundos → ms acotados; basura → por defecto", () => {
    expect(retryAfterMs("2", 9)).toBe(2000);
    expect(retryAfterMs("0", 9)).toBe(250);
    expect(retryAfterMs("3600", 9)).toBe(10_000);
    expect(retryAfterMs(null, 7)).toBe(7);
    expect(retryAfterMs("pronto", 7)).toBe(7);
  });
});
