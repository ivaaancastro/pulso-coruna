import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

export const testDatabaseUrl = process.env["PULSO_TEST_DATABASE_URL"];

/** Las tablas las crea la ingesta; los tests aplican sus mismos ficheros SQL (sin importar su código). */
const MIGRATIONS = fileURLToPath(new URL("../../ingest/migrations/", import.meta.url));

/** Crea una base de datos con el esquema de la ingesta, exclusiva para un fichero de tests. */
export async function createTestDb(): Promise<{ sql: Sql; drop(): Promise<void> }> {
  if (!testDatabaseUrl) throw new Error("PULSO_TEST_DATABASE_URL no definida");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  const files = (await readdir(MIGRATIONS)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const f of files) await sql.unsafe(await readFile(`${MIGRATIONS}${f}`, "utf8"));
  return {
    sql,
    async drop() {
      await sql.end({ timeout: 2 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 2 });
    },
  };
}

/** Una BD vacía, sin tablas (la ingesta aún no ha migrado). */
export async function createBareDb(): Promise<{ sql: Sql; drop(): Promise<void> }> {
  if (!testDatabaseUrl) throw new Error("PULSO_TEST_DATABASE_URL no definida");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  return {
    sql,
    async drop() {
      await sql.end({ timeout: 2 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 2 });
    },
  };
}
