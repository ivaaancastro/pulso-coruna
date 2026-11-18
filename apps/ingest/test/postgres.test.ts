import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCycle } from "../src/cycle.js";
import { migrate } from "../src/db/migrate.js";
import { PgStore } from "../src/db/store.js";
import { startScheduler } from "../src/scheduler.js";
import { bus, fail, fakeAdapter, makeDeps, ok, station, T0, wind } from "./helpers.js";
import { createTestDb, testDatabaseUrl } from "./test-db.js";

// Se salta limpiamente sin Docker (ver test/global-setup.ts y ADR-0015).
describe.skipIf(!testDatabaseUrl)("PostgreSQL + TimescaleDB (integración)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let store: PgStore;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop?.();
  });

  it("las migraciones se aplican, y aplicarlas otra vez no hace nada", async () => {
    const first = await migrate(sql);
    expect(first).toEqual(["0001_tables.sql", "0002_retention.sql"]);
    expect(await migrate(sql)).toEqual([]);
    expect(await migrate(sql)).toEqual([]);
    store = new PgStore(sql);
  });

  it("migraciones concurrentes no chocan (advisory lock)", async () => {
    const other = await createTestDb();
    try {
      const results = await Promise.all([
        migrate(other.sql),
        migrate(other.sql),
        migrate(other.sql),
      ]);
      expect(results.flat()).toHaveLength(2); // solo una de las tres las aplica
    } finally {
      await other.drop();
    }
  });

  it("crea hypertables, agregados continuos y políticas de compresión y retención", async () => {
    const tables = await sql<{ hypertable_name: string }[]>`
      select hypertable_name from timescaledb_information.hypertables order by 1`;
    expect(tables.map((t) => t.hypertable_name)).toEqual([
      "observations",
      "positions",
      "station_status",
    ]);
    const caggs = await sql<{ view_name: string }[]>`
      select view_name from timescaledb_information.continuous_aggregates order by 1`;
    expect(caggs.map((c) => c.view_name)).toEqual([
      "observations_1m",
      "positions_1m",
      "station_status_1m",
    ]);
    const jobs = await sql<{ proc_name: string; n: string }[]>`
      select proc_name, count(*)::text as n from timescaledb_information.jobs
      where hypertable_name in ('positions', 'station_status', 'observations')
      group by 1 order by 1`;
    expect(Object.fromEntries(jobs.map((j) => [j.proc_name, j.n]))).toMatchObject({
      policy_compression: "3",
      policy_retention: "3",
    });
  });

  it("inserción idempotente: el mismo (id, ts) no duplica en ninguna tabla", async () => {
    const rows = {
      positions: [bus("b1"), bus("b2")],
      stations: [station("s1")],
      observations: [wind("w1")],
    };
    expect(await store.write(rows)).toBe(4);
    expect(await store.write(rows)).toBe(0);
    // mismo id, otro ts: sí es una fila nueva
    expect(
      await store.write({
        ...rows,
        positions: [bus("b1", T0 + 15_000)],
        stations: [],
        observations: [],
      }),
    ).toBe(1);
    const [c] = await sql<{ p: string; s: string; o: string }[]>`
      select (select count(*) from positions)::text p,
             (select count(*) from station_status)::text s,
             (select count(*) from observations)::text o`;
    expect(c).toEqual({ p: "3", s: "1", o: "1" });
  });

  it("round-trip: ts en epoch ms y meta jsonb se conservan", async () => {
    await store.write({
      positions: [{ ...bus("b9", T0 + 1), heading: 90, speed: 7.5, meta: { line: "1", n: 3 } }],
      stations: [],
      observations: [],
    });
    const [r] = await sql<{ ms: string; meta: unknown; heading: number }[]>`
      select (extract(epoch from ts) * 1000)::bigint::text as ms, meta, heading from positions where id = 'b9'`;
    expect(Number(r?.ms)).toBe(T0 + 1);
    expect(r?.meta).toEqual({ line: "1", n: 3 });
    expect(r?.heading).toBe(90);
  });

  it("un lote grande (> tamaño de lote) se inserta entero", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => bus(`m${i}`));
    expect(await store.write({ positions: many, stations: [], observations: [] })).toBe(2500);
  });

  it("source_health en BD tras éxito y tras fallos consecutivos", async () => {
    const { clock, deps } = makeDeps({ maxAttempts: 1, downAfter: 2 });
    const adapter = fakeAdapter({
      id: "bici",
      intervalMs: 60_000,
      script: [ok([station("h1", T0 + 99)]), fail("HTTP 503"), fail("HTTP 503")],
    });
    const s = startScheduler([adapter], { ...deps, store });
    const get = async () =>
      (
        await sql<Record<string, unknown>[]>`select * from source_health where source_id = 'bici'`
      )[0];

    // Con BD real las promesas tardan: se espera a que el bucle vuelva a dormir antes de avanzar el reloj.
    const settled = () => vi.waitFor(() => expect(clock.pending).toBe(1));
    await clock.advance(0);
    await settled();
    expect(await get()).toMatchObject({
      status: "ok",
      consecutive_failures: 0,
      rows_written_last: 1,
      rows_written_total: "1",
      last_error: null,
      interval_ms: 60_000,
    });
    await clock.advance(60_000);
    await settled();
    expect(await get()).toMatchObject({
      status: "degraded",
      consecutive_failures: 1,
      last_error: "HTTP 503",
    });
    await clock.advance(60_000);
    await settled();
    const down = await get();
    expect(down).toMatchObject({
      status: "down",
      consecutive_failures: 2,
      rows_written_total: "1",
    });
    expect(down?.["last_success_at"]).toBeInstanceOf(Date);
    expect(down?.["last_error_at"]).toBeInstanceOf(Date);
    await s.stop();
  });

  it("ciclo completo contra Postgres: reescribir las mismas filas informa 0 nuevas", async () => {
    const { clock, deps } = makeDeps({ maxAttempts: 1 });
    const rows = [bus("c1", T0 + 5), station("c2", T0 + 5), wind("c3", T0 + 5)];
    const adapter = fakeAdapter({ id: "mix", script: [ok(rows)] });
    const first = runCycle(adapter, new AbortController().signal, { ...deps, store });
    await clock.advance(0);
    expect(await first).toMatchObject({ rowsWritten: 3 });
    const second = runCycle(adapter, new AbortController().signal, { ...deps, store });
    await clock.advance(0);
    expect(await second).toMatchObject({ rowsWritten: 0 });
    const h = await store.getHealth("mix");
    expect(h).toMatchObject({ status: "ok", rowsWrittenTotal: 3 });
  });
});
