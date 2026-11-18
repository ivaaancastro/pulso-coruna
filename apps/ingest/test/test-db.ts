import { randomBytes } from "node:crypto";
import postgres, { type Sql } from "postgres";

export const testDatabaseUrl = process.env["PULSO_TEST_DATABASE_URL"];

/** Crea una base de datos vacía y exclusiva para un fichero de tests. */
export async function createTestDb(): Promise<{ sql: Sql; drop(): Promise<void> }> {
  if (!testDatabaseUrl) throw new Error("PULSO_TEST_DATABASE_URL no definida");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  return {
    sql,
    async drop() {
      await sql.end({ timeout: 2 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 2 });
    },
  };
}
