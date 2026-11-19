import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { DeltaMessageSchema, SnapshotMessageSchema } from "@pulso/schema";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { FakeSource, T0, bus, station, testConfig, until, wind } from "./helpers.js";

const open: { close(): Promise<unknown> }[] = [];
const sockets: { terminate?: () => void; close?: () => void }[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) {
    try {
      s.close?.();
    } catch {
      /* ya cerrado */
    }
  }
  for (const a of open.splice(0)) await a.close();
});

async function start(
  over: Partial<ApiConfig> = {},
  src = new FakeSource(),
): Promise<{ src: FakeSource; base: string; port: number }> {
  const { app } = await buildApp(testConfig(over), src);
  open.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  return { src, base: `http://127.0.0.1:${port}`, port };
}

interface Client {
  ws: WebSocket;
  messages: unknown[];
  closed: Promise<CloseEvent>;
}
function connect(port: number, query = ""): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/stream${query}`);
  sockets.push(ws);
  const messages: unknown[] = [];
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  const closed = new Promise<CloseEvent>((r) => {
    ws.onclose = r;
  });
  return { ws, messages, closed };
}

/** Handshake a mano: devuelve el estado HTTP (101 si se acepta) y el socket crudo, que no contesta a pings. */
function rawUpgrade(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; socket?: Socket }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        ...headers,
      },
    });
    req.on("upgrade", (_res, socket) => {
      socket.resume();
      resolve({ status: 101, socket });
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.end();
  });
}

/** El cierre se procesa en el servidor de forma asíncrona: reintenta hasta que se acepte. */
async function eventuallyAccepted(port: number): Promise<number> {
  let status = 0;
  for (let i = 0; i < 50 && status !== 101; i++) {
    const r = await rawUpgrade(port, "/api/v1/stream");
    status = r.status;
    r.socket?.destroy();
    if (status !== 101) await new Promise((res) => setTimeout(res, 20));
  }
  return status;
}

describe("GET /api/v1/snapshot", () => {
  it("devuelve el contrato; las capas sin datos van vacías", async () => {
    const { src, base } = await start();
    src.layers.bike = [station("s1")];
    src.layers.weather = [wind("e1")];
    const res = await fetch(`${base}/api/v1/snapshot?layers=bus,bike,weather`);
    expect(res.status).toBe(200);
    const body = SnapshotMessageSchema.parse(await res.json());
    expect(body.layers.bus).toEqual([]);
    expect(body.layers.bike).toHaveLength(1);
    expect(Object.keys(body.layers)).toEqual(["bus", "bike", "weather"]);
  });

  it("sin parámetro devuelve todas las capas", async () => {
    const { base } = await start();
    const body = SnapshotMessageSchema.parse(await (await fetch(`${base}/api/v1/snapshot`)).json());
    expect(Object.keys(body.layers)).toHaveLength(8);
  });

  it("capas desconocidas o vacías → 400", async () => {
    const { base } = await start();
    for (const q of ["layers=bus,nope", "layers=", "layers=bus,"]) {
      const res = await fetch(`${base}/api/v1/snapshot?${q}`);
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_request");
    }
  });

  it("BD caída → 503 con Retry-After", async () => {
    const { src, base } = await start();
    src.failing = true;
    const res = await fetch(`${base}/api/v1/snapshot`);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("CORS abierto por defecto y restringido si se configura", async () => {
    const open1 = await start();
    const r1 = await fetch(`${open1.base}/api/v1/snapshot`, {
      headers: { Origin: "https://x.es" },
    });
    expect(r1.headers.get("access-control-allow-origin")).toBe("*");
    expect(r1.headers.get("x-content-type-options")).toBe("nosniff");

    const closed = await start({ corsOrigins: ["https://pulso.es"] });
    const ok = await fetch(`${closed.base}/api/v1/snapshot`, {
      headers: { Origin: "https://pulso.es" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://pulso.es");
    const bad = await fetch(`${closed.base}/api/v1/snapshot`, {
      headers: { Origin: "https://evil.es" },
    });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /api/v1/health", () => {
  it("estado por fuente, edad y capas", async () => {
    const { src, base } = await start({ healthCacheMs: 0 });
    const now = Date.now();
    src.health = [
      {
        sourceId: "bicicoruna",
        status: "ok",
        intervalMs: 60_000,
        lastSuccessAt: now - 10_000,
        lastErrorAt: null,
        consecutiveFailures: 0,
        updatedAt: now,
      },
    ];
    src.freshness = { bike: now - 10_000 };
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    const h = (await res.json()) as {
      status: string;
      db: { ok: boolean };
      sources: { id: string; status: string; ageMs: number }[];
      layers: Record<string, { lastDataAt: number | null }>;
    };
    expect(h.status).toBe("ok");
    expect(h.db.ok).toBe(true);
    expect(h.sources[0]).toMatchObject({ id: "bicicoruna", status: "ok" });
    expect(h.sources[0]?.ageMs).toBeGreaterThanOrEqual(10_000);
    expect(h.layers["bike"]?.lastDataAt).not.toBeNull();
    expect(h.layers["bus"]?.lastDataAt).toBeNull();
    // no se filtran mensajes de error de las fuentes
    expect(JSON.stringify(h)).not.toContain('lastError"');
  });

  it("BD caída → 503 y status down", async () => {
    const { src, base } = await start({ healthCacheMs: 0 });
    src.failing = true;
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("down");
  });
});

describe("WS /api/v1/stream", () => {
  it("snapshot al conectar y luego deltas", async () => {
    const { src, port } = await start();
    src.layers.bus = [bus("b1"), bus("b2")];
    const c = connect(port);
    await until(() => c.messages.length >= 1);
    const snap = SnapshotMessageSchema.parse(c.messages[0]);
    expect(snap.layers.bus).toHaveLength(2);
    expect(snap.ts).toBeGreaterThan(T0);

    src.layers.bus = [bus("b1", -8.5)];
    src.layers.weather = [wind("e1")];
    await until(() => c.messages.length >= 3);
    const deltas = c.messages.slice(1).map((m) => DeltaMessageSchema.parse(m));
    const busDelta = deltas.find((d) => d.layer === "bus");
    expect(busDelta?.upserts).toHaveLength(1);
    expect(busDelta?.removes).toEqual(["b2"]);
    expect(deltas.find((d) => d.layer === "weather")?.upserts).toHaveLength(1);
  });

  it("?layers filtra; capas desconocidas → 400 antes del handshake", async () => {
    const { src, port } = await start();
    src.layers.bus = [bus("b1")];
    const c = connect(port, "?layers=bike");
    await until(() => c.messages.length >= 1);
    expect(Object.keys((c.messages[0] as { layers: object }).layers)).toEqual(["bike"]);
    expect((await rawUpgrade(port, "/api/v1/stream?layers=nope")).status).toBe(400);
  });

  it("BD caída al conectar: cierre 1013 (reintentar)", async () => {
    const { src, port } = await start();
    src.failing = true;
    const c = connect(port);
    expect((await c.closed).code).toBe(1013);
  });

  it("límite de conexiones por IP: 429 al pasarse y se libera al cerrar", async () => {
    const { port } = await start({ wsMaxPerIp: 2, wsPingMs: 60_000 });
    const a = connect(port);
    const b = connect(port);
    await until(() => a.messages.length >= 1 && b.messages.length >= 1);
    const over = await rawUpgrade(port, "/api/v1/stream");
    expect(over.status).toBe(429);
    a.ws.close();
    await a.closed;
    expect(await eventuallyAccepted(port)).toBe(101);
  });

  it("cliente caído (no contesta pings) se termina y libera su hueco", async () => {
    const { port } = await start({ wsMaxPerIp: 1, wsPingMs: 50 });
    const dead = await rawUpgrade(port, "/api/v1/stream");
    expect(dead.status).toBe(101);
    const gone = new Promise<void>((r) => dead.socket?.on("close", () => r()));
    await gone; // el servidor lo corta tras dos ciclos sin pong
    expect(await eventuallyAccepted(port)).toBe(101);
  });

  it("un cliente sano (contesta pongs) sigue conectado más allá de varios ciclos de ping", async () => {
    const { port } = await start({ wsPingMs: 50 });
    const c = connect(port);
    await until(() => c.messages.length >= 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("origen no permitido → 403 si hay lista de orígenes", async () => {
    const { port } = await start({ corsOrigins: ["https://pulso.es"] });
    expect((await rawUpgrade(port, "/api/v1/stream", { Origin: "https://evil.es" })).status).toBe(
      403,
    );
    const ok = await rawUpgrade(port, "/api/v1/stream", { Origin: "https://pulso.es" });
    expect(ok.status).toBe(101);
    ok.socket?.destroy();
  });

  it("sin clientes la API no consulta la BD", async () => {
    const { src, port } = await start();
    const c = connect(port);
    await until(() => c.messages.length >= 1);
    c.ws.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 150));
    const calls = src.latestCalls;
    await new Promise((r) => setTimeout(r, 400));
    expect(src.latestCalls).toBe(calls);
  });
});
