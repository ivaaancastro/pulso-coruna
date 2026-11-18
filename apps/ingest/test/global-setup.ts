import { execFileSync, spawnSync } from "node:child_process";
import postgres from "postgres";

/** Debe coincidir con ADR-0016. */
export const TIMESCALE_IMAGE = "timescale/timescaledb:2.32.0-pg17";

const docker = (...args: string[]): string =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
  return r.status === 0;
}

async function waitForPostgres(url: string): Promise<void> {
  // Durante la inicialización la imagen solo escucha por socket unix: si responde TCP, ya es el servidor final.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    try {
      await sql`select 1`;
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }
}

/**
 * Arranca un TimescaleDB efímero para los tests de integración y exporta su URL en
 * `PULSO_TEST_DATABASE_URL`. Sin Docker (o con `PULSO_TEST_DB=skip`) no hace nada y esos tests se saltan.
 */
export default async function setup(): Promise<(() => void) | undefined> {
  if (process.env["PULSO_TEST_DB"] === "skip") return undefined;
  if (process.env["PULSO_TEST_DATABASE_URL"]) return undefined; // BD ya existente aportada por el usuario
  if (!dockerAvailable()) {
    console.warn("[ingest tests] Docker no disponible: se saltan los tests de integración");
    return undefined;
  }
  const name = `pulso-ingest-test-${process.pid}`;
  docker(
    "run", "-d", "--rm", "--name", name,
    "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_USER=pulso", "-e", "POSTGRES_PASSWORD=pulso", "-e", "POSTGRES_DB=pulso",
    TIMESCALE_IMAGE,
  ); // prettier-ignore
  const stop = (): void => {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  };
  try {
    const port = docker("port", name, "5432/tcp").split("\n")[0]?.split(":").pop();
    if (!port) throw new Error("no se pudo averiguar el puerto del contenedor");
    const url = `postgres://pulso:pulso@127.0.0.1:${port}/pulso`;
    await waitForPostgres(url);
    process.env["PULSO_TEST_DATABASE_URL"] = url;
  } catch (e) {
    stop();
    throw e;
  }
  return stop;
}
