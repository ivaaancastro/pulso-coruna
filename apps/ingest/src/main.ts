import { consoleLogger, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { PgStore, connect } from "./db/store.js";
import { adapters } from "./registry.js";
import { startScheduler } from "./scheduler.js";

const config = loadConfig();
const logger = consoleLogger;
const sql = connect(config.databaseUrl);

const applied = await migrate(sql);
logger.info("migraciones al día", { applied });
if (adapters.length === 0) logger.warn("no hay adaptadores registrados (src/registry.ts)");

const scheduler = startScheduler(adapters, {
  store: new PgStore(sql),
  clock: systemClock,
  logger,
  config,
});
logger.info("ingesta en marcha", { sources: adapters.map((a) => a.id) });

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info("apagando", { signal });
  // Si un adaptador ignora la señal, no esperamos más de 10 s.
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await scheduler.stop();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
