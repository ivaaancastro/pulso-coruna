import { resolve } from "node:path";
import type { ValidRows } from "../src/types.js";
import { PgStore, connect } from "../src/db/store.js";
import { migrate } from "../src/db/migrate.js";
import { cutoffFor, runRetention } from "../src/db/retention.js";
import { tickAt } from "./synthetic.js";

/**
 * Siembra datos SINTÉTICOS en una TimescaleDB local (puerta de M6). Sin red externa; ver docs/specs/M6-puerta.md.
 *
 *   DATABASE_URL=postgres://… pnpm --filter @pulso/ingest seed:synthetic [--hours 36] [--follow]
 *
 * - Últimas `--hours` h (36) con ticks cada 15 s hasta «ahora».
 * - Una franja de ±3 h alrededor del corte raw/1m (`now − RETENTION_RAW_DAYS`, 30 d) para probar la ventana
 *   que cruza el corte (`--no-cutoff-strip` la omite). Se agrega a `*_1m` y se ejecuta la retención.
 * - `--follow`: sigue escribiendo un tick cada 15 s (el directo y «Ahora» tienen datos frescos).
 */
const TICK = 15_000;
const HOUR = 3_600_000;

const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const opt = (n: string, d: number): number => {
  const i = args.indexOf(n);
  const v = i >= 0 ? Number(args[i + 1]) : d;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${n} inválido`);
  return v;
};

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("Falta DATABASE_URL");
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) && process.env["SEED_ALLOW_REMOTE"] !== "1")
  throw new Error("Solo siembra BDs locales (SEED_ALLOW_REMOTE=1 para forzarlo): son datos falsos");

const hours = opt("--hours", 36);
const rawDays = Number(process.env["RETENTION_RAW_DAYS"] ?? 30);
const sql = connect(url, { statementTimeoutMs: 600_000 });
const store = new PgStore(sql, 300_000);
const logger = {
  info: (m: string, f?: unknown) => console.log(m, f ?? ""),
  warn: (m: string, f?: unknown) => console.warn(m, f ?? ""),
  error: (m: string, f?: unknown) => console.error(m, f ?? ""),
};

async function writeRange(from: number, to: number): Promise<number> {
  let total = 0;
  const start = Math.ceil(from / TICK) * TICK;
  for (let h = start; h < to; h += HOUR) {
    const rows: ValidRows = { positions: [], stations: [], observations: [] };
    for (let t = h; t < Math.min(h + HOUR, to); t += TICK) {
      const k = tickAt(t);
      rows.positions.push(...k.positions);
      rows.stations.push(...k.stations);
      rows.observations.push(...k.observations);
    }
    total += await store.write(rows);
  }
  return total;
}

async function main(): Promise<void> {
  const applied = await migrate(sql, `${resolve("migrations")}/`);
  console.log("migraciones aplicadas:", applied.length ? applied.join(", ") : "(ninguna nueva)");
  const now = Date.now();
  const cut = cutoffFor(now, rawDays).getTime();
  let n = await writeRange(now - hours * HOUR, now);
  console.log(`recientes: ${n} filas (${hours} h hasta ahora)`);
  if (!flag("--no-cutoff-strip")) {
    n = await writeRange(cut - 3 * HOUR, cut + 3 * HOUR);
    console.log(`franja del corte (${new Date(cut).toISOString()} ±3 h): ${n} filas`);
    const res = await runRetention(sql, { nowMs: now, rawDays, logger });
    console.log("retención:", JSON.stringify(res?.map((r) => [r.target, r.error ?? "ok"])));
  }
  if (!flag("--follow")) return;
  console.log("--follow: un tick cada 15 s (Ctrl+C para parar)");
  let next = Math.floor(Date.now() / TICK) * TICK + TICK;
  for (;;) {
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
    await writeRange(next, next + 1);
    next += TICK;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!flag("--follow")) void sql.end({ timeout: 5 });
  });
