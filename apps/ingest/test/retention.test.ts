import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/clock.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { cutoffFor, runRetention, startRetention } from "../src/db/retention.js";
import { FakeClock } from "./fake-clock.js";
import { createTestDb, testDatabaseUrl } from "./test-db.js";

const DAY = 86_400_000;
const MIN = 60_000;

describe("cutoffFor (puro)", () => {
  it("resta los días y redondea hacia abajo al minuto", () => {
    const now = Date.UTC(2026, 10, 19, 12, 34, 56, 789);
    expect(cutoffFor(now, 30).toISOString()).toBe("2026-10-20T12:34:00.000Z");
    expect(cutoffFor(now, 1).toISOString()).toBe("2026-11-18T12:34:00.000Z");
  });
});

describe("config de retención (puro)", () => {
  const base = { DATABASE_URL: "postgres://x" };
  it("por defecto: activa, 30 días, cada hora", () => {
    expect(loadConfig(base).retention).toMatchObject({
      enabled: true,
      rawDays: 30,
      intervalMs: 3_600_000,
    });
  });
  it("se configura por env y valida", () => {
    const r = loadConfig({ ...base, RETENTION_ENABLED: "false", RETENTION_RAW_DAYS: "10" });
    expect(r.retention).toMatchObject({ enabled: false, rawDays: 10 });
    expect(() => loadConfig({ ...base, RETENTION_ENABLED: "quizá" })).toThrow(/RETENTION_ENABLED/);
    expect(() => loadConfig({ ...base, RETENTION_RAW_DAYS: "0" })).toThrow(/RETENTION_RAW_DAYS/);
    expect(() => loadConfig({ ...base, RETENTION_RAW_DAYS: "3" })).toThrow(/>= 7/);
  });
});

describe("startRetention (puro)", () => {
  it("desactivada no toca la BD", async () => {
    const sql = new Proxy({}, { get: () => () => Promise.reject(new Error("no debe usarse")) });
    const job = startRetention(sql as unknown as Sql, {
      config: { enabled: false, rawDays: 30, intervalMs: 1000, statementTimeoutMs: 1000 },
      clock: new FakeClock(),
      logger: silentLogger,
    });
    await job.stop();
  });
});

describe.skipIf(!testDatabaseUrl)("retención contra TimescaleDB (sintético, >30 días)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  // Todo anclado a un «ahora» fijo alineado al minuto.
  const now = Math.floor(Date.now() / MIN) * MIN;
  const cutoff = cutoffFor(now, 30).getTime();
  const logger = silentLogger;

  /** 2 móviles, una muestra cada 15 s durante 10 min desde `startMs`; lon = índice de muestra. */
  const seedPositions = (startMs: number) => sql`
    insert into positions (id, ts, layer, lon, lat)
    select e.id, to_timestamp((${startMs}::bigint + i * 15000) / 1000.0), 'bus', i, 43.0
    from generate_series(0, 39) i, (values ('b1'), ('b2')) as e(id)
    on conflict do nothing`;
  const seedStations = (startMs: number) => sql`
    insert into station_status (id, ts, layer, lon, lat, bikes, docks)
    select 's1', to_timestamp((${startMs}::bigint + i * 15000) / 1000.0), 'bike', -8.4, 43.3, i, 40 - i
    from generate_series(0, 39) i on conflict do nothing`;
  const seedObs = (startMs: number) => sql`
    insert into observations (station_id, metric, ts, layer, value, unit)
    select 'w1', 'wind_speed', to_timestamp((${startMs}::bigint + i * 15000) / 1000.0), 'weather', i, 'm/s'
    from generate_series(0, 39) i on conflict do nothing`;
  const count = async (q: string): Promise<number> =>
    Number((await sql.unsafe<{ n: string }[]>(`select count(*)::text n from ${q}`))[0]?.n);

  const OLD = (v: string): string => `${v} where bucket < to_timestamp(${cutoff / 1000})`;
  const old1 = Math.floor((now - 40 * DAY) / MIN) * MIN; // chunk anterior al corte
  const old2 = Math.floor((now - 35 * DAY) / MIN) * MIN;
  const recent = now - 60 * MIN;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
    await migrate(sql);
    for (const seed of [seedPositions, seedStations, seedObs]) {
      await seed(old1);
      await seed(recent);
    }
  });
  afterAll(async () => {
    await drop?.();
  });

  it("la migración 0003 quita las políticas de retención de Timescale", async () => {
    const [r] = await sql<{ n: string }[]>`
      select count(*)::text n from timescaledb_information.jobs where proc_name = 'policy_retention'`;
    expect(r?.n).toBe("0");
  });

  it("borra brutos antiguos, deja 1 muestra/min/entidad (la última del minuto) y no toca lo reciente", async () => {
    expect(await count("positions")).toBe(160);
    const res = await runRetention(sql, { nowMs: now, rawDays: 30, logger });
    expect(res?.map((r) => r.error)).toEqual([undefined, undefined, undefined]);
    expect(res?.every((r) => r.droppedChunks >= 1)).toBe(true);

    // brutos antiguos: fuera; recientes: intactos
    expect(await count(`positions where ts < to_timestamp(${cutoff / 1000})`)).toBe(0);
    expect(await count("positions")).toBe(80);
    expect(await count("station_status")).toBe(40);
    expect(await count("observations")).toBe(40);

    // baja resolución: 10 minutos × entidad, con el valor de la última muestra del minuto (i = 4k+3)
    expect(await count("positions_1m where bucket < now() - interval '30 days'")).toBe(20);
    const b1 = await sql<{ lon: number }[]>`
      select lon from positions_1m where id = 'b1' and bucket < ${new Date(cutoff)} order by bucket`;
    expect(b1.map((r) => r.lon)).toEqual([3, 7, 11, 15, 19, 23, 27, 31, 35, 39]);
    expect(await count("station_status_1m where bucket < now() - interval '30 days'")).toBe(10);
    const obs = await sql<{ value: number }[]>`
      select value from observations_1m where station_id = 'w1' and bucket < ${new Date(cutoff)} order by bucket limit 2`;
    expect(obs.map((r) => r.value)).toEqual([3, 7]);
  });

  it("es idempotente: una segunda pasada no cambia nada", async () => {
    const before = [
      await count("positions"),
      await count(OLD("positions_1m")),
      await count(OLD("station_status_1m")),
      await count(OLD("observations_1m")),
    ];
    const res = await runRetention(sql, { nowMs: now, rawDays: 30, logger });
    expect(res?.every((r) => r.droppedChunks === 0 && !r.error)).toBe(true);
    expect([
      await count("positions"),
      await count(OLD("positions_1m")),
      await count(OLD("station_status_1m")),
      await count(OLD("observations_1m")),
    ]).toEqual(before);
    const [s] = await sql<{ dropped_total: string; last_error: string | null }[]>`
      select dropped_total::text, last_error from retention_status where target = 'positions'`;
    expect(s?.last_error).toBeNull();
    expect(Number(s?.dropped_total)).toBeGreaterThanOrEqual(1);
  });

  it("se pone al día: datos antiguos llegados después (o días sin pasar el job) se agregan y se borran", async () => {
    await seedPositions(old2); // 35 días atrás, tras haber pasado ya el job
    expect(await count(`positions where ts < to_timestamp(${cutoff / 1000})`)).toBe(80);
    const res = await runRetention(sql, { nowMs: now, rawDays: 30, logger });
    expect(res?.[0]?.error).toBeUndefined();
    expect(await count(`positions where ts < to_timestamp(${cutoff / 1000})`)).toBe(0);
    expect(await count("positions_1m where bucket < now() - interval '30 days'")).toBe(40);
    expect(await count("positions")).toBe(80);
  });

  it("no borra brutos sin agregar: si el refresco falla, la tabla se deja intacta", async () => {
    // rawDays 20: el chunk de 7 días que contiene old2 (35 d) queda entero por detrás del corte
    const cutoff20 = cutoffFor(now, 20).getTime();
    await seedStations(old2);
    await sql`alter materialized view station_status_1m rename to station_status_1m_x`;
    try {
      const res = await runRetention(sql, { nowMs: now, rawDays: 20, logger });
      expect(res?.[1]?.error).toBeTruthy();
      expect(res?.[1]?.droppedChunks).toBe(0);
      // las otras tablas siguen procesándose
      expect(res?.[0]?.error).toBeUndefined();
      expect(res?.[2]?.error).toBeUndefined();
      expect(await count(`station_status where ts < to_timestamp(${cutoff20 / 1000})`)).toBe(40);
      const [s] = await sql<{ last_error: string | null }[]>`
        select last_error from retention_status where target = 'station_status'`;
      expect(s?.last_error).toBeTruthy();
    } finally {
      await sql`alter materialized view station_status_1m_x rename to station_status_1m`;
    }
    // recuperada la vista, la siguiente pasada pone todo al día
    const res = await runRetention(sql, { nowMs: now, rawDays: 20, logger });
    expect(res?.[1]?.error).toBeUndefined();
    expect(await count(`station_status where ts < to_timestamp(${cutoff20 / 1000})`)).toBe(0);
    expect(await count(`station_status_1m where bucket < to_timestamp(${cutoff20 / 1000})`)).toBe(
      20,
    );
  });

  it("consulta unificada: brutos recientes + 1/min antiguos, sin solapes ni huecos", async () => {
    const rows = await sql<{ id: string; ts: Date; src: string }[]>`
      select id, ts, 'raw' as src from positions where ts >= ${new Date(cutoff)}
      union all
      select id, bucket as ts, '1m' as src from positions_1m where bucket < ${new Date(cutoff)}
      order by ts`;
    expect(rows.filter((r) => r.src === "1m")).toHaveLength(40);
    expect(rows.filter((r) => r.src === "raw")).toHaveLength(80);
    expect(rows.every((r) => (r.src === "raw") === r.ts.getTime() >= cutoff)).toBe(true);
  });

  it("no corre dos veces a la vez (advisory lock)", async () => {
    const held = await sql.reserve();
    try {
      await held`select pg_advisory_lock(73036)`;
      expect(await runRetention(sql, { nowMs: now, rawDays: 30, logger })).toBeNull();
    } finally {
      await held`select pg_advisory_unlock(73036)`;
      held.release();
    }
  });

  it("el bucle arranca con una pasada, se repite con el reloj y para limpiamente", async () => {
    const clock = new FakeClock();
    let tick = 0;
    clock.now = () => now + tick * 1000;
    const job = startRetention(sql, {
      config: { enabled: true, rawDays: 30, intervalMs: 1000, statementTimeoutMs: 60_000 },
      clock,
      logger,
    });
    const lastRun = async (): Promise<number> => {
      const [r] = await sql<
        { t: Date }[]
      >`select last_run_at t from retention_status where target = 'observations'`;
      return r?.t.getTime() ?? 0;
    };
    await vi.waitFor(async () => expect(await lastRun()).toBe(now), { timeout: 10_000 });
    await vi.waitFor(() => expect(clock.pending).toBe(1), { timeout: 10_000 });
    tick = 1;
    await clock.advance(1000);
    await vi.waitFor(async () => expect(await lastRun()).toBe(now + 1000), { timeout: 10_000 });
    await job.stop();
  });
});
