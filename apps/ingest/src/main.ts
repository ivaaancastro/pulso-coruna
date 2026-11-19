import { consoleLogger, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { migrateWithRetry } from "./db/migrate.js";
import { startRetention } from "./db/retention.js";
import { PgStore, connect } from "./db/store.js";
import { adapters } from "./registry.js";
import { startScheduler } from "./scheduler.js";

const logger = consoleLogger;
const config = loadConfig();
const sql = connect(config.databaseUrl, {
  connectTimeoutS: config.dbConnectTimeoutS,
  idleTimeoutS: config.dbIdleTimeoutS,
  maxLifetimeS: config.dbMaxLifetimeS,
  statementTimeoutMs: config.dbStatementTimeoutMs,
});

// Pool propio para la retención: su statement_timeout es mucho mayor que el de la ingesta.
const retentionSql = connect(config.databaseUrl, {
  connectTimeoutS: config.dbConnectTimeoutS,
  idleTimeoutS: config.dbIdleTimeoutS,
  maxLifetimeS: config.dbMaxLifetimeS,
  statementTimeoutMs: config.retention.statementTimeoutMs,
});

const boot = new AbortController();
let scheduler: ReturnType<typeof startScheduler> | undefined;
let retention: ReturnType<typeof startRetention> | undefined;
let stopping = false;

const shutdown = async (signal: string, code = 0): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info("apagando", { signal });
  boot.abort();
  // Si un adaptador ignora la señal, no esperamos más de 10 s.
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await scheduler?.stop();
  await retention?.stop();
  await Promise.allSettled(adapters.map((a) => a.close?.()));
  await sql.end({ timeout: 5 }).catch(() => {});
  await retentionSql.end({ timeout: 5 }).catch(() => {});
  process.exit(code);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const applied = await migrateWithRetry(sql, {
    attempts: config.migrateAttempts,
    backoff: { baseMs: config.backoffBaseMs, maxMs: config.backoffMaxMs },
    clock: systemClock,
    logger,
    signal: boot.signal,
  });
  logger.info("migraciones al día", { applied });
} catch (e) {
  logger.error("arranque fallido: la BD no está lista", {
    error: e instanceof Error ? e.message : String(e),
  });
  await shutdown("arranque fallido", 1);
}

if (!stopping) {
  if (adapters.length === 0) logger.warn("no hay adaptadores registrados (src/registry.ts)");
  scheduler = startScheduler(adapters, {
    store: new PgStore(sql, config.dbStatementTimeoutMs + 5_000),
    clock: systemClock,
    logger,
    config,
  });
  retention = startRetention(retentionSql, {
    config: config.retention,
    clock: systemClock,
    logger,
  });
  logger.info("ingesta en marcha", { sources: adapters.map((a) => a.id) });
}
