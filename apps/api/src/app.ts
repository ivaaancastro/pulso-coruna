import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { LayerId } from "@pulso/schema";
import Fastify, { type FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ApiConfig } from "./config.js";
import type { DataSource } from "./db.js";
import { buildHealth, type HealthReport } from "./health.js";
import { StreamHub } from "./hub.js";
import { ConnectionLimiter } from "./limiter.js";
import { parseLayers, snapshotMessage } from "./protocol.js";

export interface BuiltApi {
  app: FastifyInstance;
  hub: StreamHub;
}

interface Tracked {
  socket: WebSocket;
  alive: boolean;
}

/** Códigos de cierre WS propios (rango 4000+ reservado a aplicaciones; 1008/1013 son estándar). */
export const WS_CLOSE = {
  tooManyConnections: 1008,
  tryAgainLater: 1013,
  tooSlow: 1008,
} as const;

export async function buildApp(config: ApiConfig, source: DataSource): Promise<BuiltApi> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
  });
  const wildcard = config.corsOrigins.includes("*");

  await app.register(cors, {
    origin: wildcard ? "*" : config.corsOrigins,
    methods: ["GET", "HEAD", "OPTIONS"],
    maxAge: 86_400,
  });
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
  });

  const hub = new StreamHub(source, {
    pollMs: config.pollMs,
    maxBufferedBytes: config.wsMaxBufferedBytes,
    log: app.log,
  });
  const limiter = new ConnectionLimiter(config.wsMaxPerIp);
  const tracked = new Set<Tracked>();

  // --- GET /api/v1/snapshot?layers=bus,bike ---
  app.get("/api/v1/snapshot", async (req, reply) => {
    const parsed = parseLayers((req.query as Record<string, unknown>)["layers"]);
    if (!parsed.ok) return reply.code(400).send({ error: "bad_request", message: parsed.error });
    try {
      const latest = await source.latest(config.snapshotCacheMs);
      reply.header("Cache-Control", "no-store");
      return snapshotMessage(latest.ts, parsed.layers, latest.layers);
    } catch (e) {
      req.log.error({ err: e }, "snapshot: BD no disponible");
      return reply
        .code(503)
        .header("Retry-After", "5")
        .send({ error: "unavailable", message: "base de datos no disponible" });
    }
  });

  // --- GET /api/v1/health --- (en caché unos segundos y con consultas unidas)
  let healthCache: { at: number; report: HealthReport } | undefined;
  let healthInflight: Promise<HealthReport> | undefined;
  const computeHealth = async (): Promise<HealthReport> => {
    const now = Date.now();
    const staleFactor = config.healthStaleFactor;
    try {
      const latencyMs = await source.ping();
      const [sources, freshness] = await Promise.all([
        source.sourceHealth(),
        source.layerFreshness(),
      ]);
      return buildHealth({ now, staleFactor, db: { ok: true, latencyMs }, sources, freshness });
    } catch (e) {
      app.log.warn({ err: String(e) }, "health: BD no disponible");
      const db = { ok: false, latencyMs: null };
      return buildHealth({ now, staleFactor, db, sources: [], freshness: {} });
    }
  };
  app.get("/api/v1/health", async (_req, reply) => {
    const t = Date.now();
    let report: HealthReport;
    if (healthCache && t - healthCache.at <= config.healthCacheMs) {
      report = healthCache.report;
    } else {
      healthInflight ??= computeHealth().finally(() => {
        healthInflight = undefined;
      });
      report = await healthInflight;
      healthCache = { at: Date.now(), report };
    }
    reply.header("Cache-Control", "no-store");
    return reply.code(report.db.ok ? 200 : 503).send(report);
  });

  // --- WS /api/v1/stream[?layers=...] ---
  app.get(
    "/api/v1/stream",
    {
      websocket: true,
      // Rechazos antes del handshake: el cliente recibe un HTTP con el motivo.
      preValidation: async (req, reply) => {
        const parsed = parseLayers((req.query as Record<string, unknown>)["layers"]);
        if (!parsed.ok)
          return reply.code(400).send({ error: "bad_request", message: parsed.error });
        const origin = req.headers.origin;
        if (!wildcard && origin !== undefined && !config.corsOrigins.includes(origin)) {
          return reply.code(403).send({ error: "forbidden", message: "origen no permitido" });
        }
        if (limiter.isFull(req.ip)) {
          return reply
            .code(429)
            .header("Retry-After", "10")
            .send({
              error: "too_many_connections",
              message: `máximo ${config.wsMaxPerIp} conexiones simultáneas por IP`,
            });
        }
        return undefined;
      },
    },
    (socket, req) => {
      const ip = req.ip;
      // Comprobación definitiva (la anterior es solo un rechazo temprano; aquí se reserva el hueco).
      if (!limiter.acquire(ip)) {
        socket.close(WS_CLOSE.tooManyConnections, "demasiadas conexiones desde esta IP");
        return;
      }
      const parsed = parseLayers((req.query as Record<string, unknown>)["layers"]);
      const layers = new Set<LayerId>(parsed.ok ? parsed.layers : []);
      const t: Tracked = { socket, alive: true };
      tracked.add(t);
      let detach: (() => void) | undefined;
      let closed = false;
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        tracked.delete(t);
        limiter.release(ip);
        detach?.();
      };
      socket.on("pong", () => {
        t.alive = true;
      });
      socket.on("close", cleanup);
      socket.on("error", (err) => {
        req.log.debug({ err: String(err) }, "error de socket WS");
        socket.terminate();
        cleanup();
      });
      // El protocolo es solo servidor → cliente: se ignora lo que llegue.
      socket.on("message", () => {});

      hub
        .attach({
          layers,
          send: (data) => socket.send(data),
          bufferedAmount: () => socket.bufferedAmount,
          drop: (reason) => {
            socket.close(WS_CLOSE.tooSlow, reason);
            setTimeout(() => socket.terminate(), 1_000).unref();
          },
        })
        .then((d) => {
          if (closed) d();
          else detach = d;
        })
        .catch((e: unknown) => {
          req.log.warn({ err: String(e) }, "stream: BD no disponible");
          socket.close(WS_CLOSE.tryAgainLater, "base de datos no disponible, reintenta");
        });
    },
  );

  // Ping periódico: lo que no contesta pong en un ciclo se da por caído y se libera.
  const pinger = setInterval(() => {
    for (const t of tracked) {
      if (!t.alive) {
        t.socket.terminate();
        continue;
      }
      t.alive = false;
      try {
        t.socket.ping();
      } catch {
        t.socket.terminate();
      }
    }
  }, config.wsPingMs);
  pinger.unref();

  app.addHook("onClose", async () => {
    clearInterval(pinger);
    hub.stop();
  });

  return { app, hub };
}
