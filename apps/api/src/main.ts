import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PgDataSource, connect } from "./db.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = connect(config.databaseUrl, config);
  // El logger de Fastify existe tras construir la app, y la app necesita la fuente: se enlaza después.
  const warn = { fn: (m: string): void => console.warn(m) };
  const source = new PgDataSource(sql, config.maxAgeMs, Date.now, (m) => warn.fn(m));
  const { app } = await buildApp(config, source);
  warn.fn = (m) => app.log.warn(m);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "apagando");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await app.close().catch(() => {});
    await source.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((e: unknown) => {
  console.error("arranque fallido:", e instanceof Error ? e.message : e);
  process.exit(1);
});
