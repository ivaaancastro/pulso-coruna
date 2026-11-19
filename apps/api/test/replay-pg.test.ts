import type { AddressInfo } from "node:net";
import { decode } from "@msgpack/msgpack";
import { REPLAY_WINDOW_MS as W, ReplayWindowSchema } from "@pulso/schema";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PgDataSource } from "../src/db.js";
import { readReplayRows } from "../src/replay-db.js";
import { testConfig } from "./helpers.js";
import { createBareDb, createTestDb, testDatabaseUrl } from "./test-db.js";

const MIN = 60_000;
const DAY = 86_400_000;
const align = (ms: number): number => Math.floor(ms / W) * W;
const RAW = align(Date.now() - 3 * 60 * MIN); // ventana reciente (datos brutos)
const OLD = align(Date.now() - 40 * DAY); // ventana de >30 días (solo 1 min)
const d = (ms: number): Date => new Date(ms);
const lookbackMs = { entity: 5 * MIN, station: 60 * MIN, observation: 6 * 60 * MIN };

// Se salta sin Docker o con PULSO_TEST_DB=skip (ver test/global-setup.ts y ADR-0016).
describe.skipIf(!testDatabaseUrl)("replay sobre TimescaleDB (integración)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:1', ${d(RAW - 2 * MIN)}, 'bus', -8.40, 43.36, 90, 5, ${sql.json({ line: "1A" })}),
      ('bus:1', ${d(RAW + 15_000)},  'bus', -8.41, 43.37, null, null, null),
      ('bus:1', ${d(RAW + W)},       'bus', -8.42, 43.38, null, null, null),
      ('ship:1', ${d(RAW + 1000)},   'ship', -8.30, 43.40, 10, 2, null)`;
    await sql`insert into station_status (id, ts, layer, lon, lat, bikes, docks) values
      ('st:1', ${d(RAW - 10 * MIN)}, 'bike', -8.4, 43.3, 2, 8),
      ('st:1', ${d(RAW + MIN)},      'bike', -8.4, 43.3, 4, 6)`;
    await sql`insert into observations (station_id, metric, ts, layer, value, unit) values
      ('m1', 'wind_speed', ${d(RAW - 30 * MIN)}, 'weather', 3, 'm/s'),
      ('m1', 'wind_speed', ${d(RAW + 2 * MIN)}, 'weather', 6, 'm/s'),
      ('m1', 'tide',       ${d(RAW + 2 * MIN)}, 'sea', 1.5, 'm')`;
    // Datos antiguos: dos muestras en el mismo minuto (queda la última) y estado inicial previo.
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:1', ${d(OLD - 2 * MIN + 5000)}, 'bus', -8.40, 43.36, 90, 5, null),
      ('bus:1', ${d(OLD + MIN + 10_000)},   'bus', -8.45, 43.30, 91, 6, null),
      ('bus:1', ${d(OLD + MIN + 40_000)},   'bus', -8.46, 43.31, 92, 7, null)`;
    await sql`insert into station_status (id, ts, layer, lon, lat, bikes, docks) values
      ('st:1', ${d(OLD + 3 * MIN)}, 'bike', -8.4, 43.3, 9, 1)`;
    await sql`insert into observations (station_id, metric, ts, layer, value, unit) values
      ('m1', 'wind_speed', ${d(OLD + 2 * MIN + 1000)}, 'weather', 7, 'm/s')`;
    for (const v of ["positions_1m", "station_status_1m", "observations_1m"]) {
      // Ventana explícita alrededor de los datos antiguos (un refresh abierto procesa por lotes y se salta lo lejano).
      await sql.unsafe(
        `call refresh_continuous_aggregate('${v}', '${d(OLD - 10 * MIN).toISOString()}', '${d(OLD + 10 * MIN).toISOString()}')`,
      );
    }
  });
  afterAll(async () => {
    await drop?.();
  });

  it("raw: ventana [from,to) + último valor anterior por entidad", async () => {
    const q = {
      from: RAW,
      to: RAW + W,
      layers: ["bus", "bike", "weather"] as const,
      resolution: "raw" as const,
      lookbackMs,
      maxRows: 1000,
    };
    const r = await readReplayRows(sql, { ...q, layers: [...q.layers] });
    expect(r.truncated).toBe(false);
    expect(r.positions.rows.map((p) => [p.id, p.ts - RAW])).toEqual([["bus:1", 15_000]]); // sin ship, sin el de `to`
    expect(r.positions.init).toHaveLength(1);
    expect(r.positions.init[0]).toMatchObject({ id: "bus:1", heading: 90, meta: { line: "1A" } });
    expect(r.stations.rows).toHaveLength(1);
    expect(r.stations.init[0]).toMatchObject({ bikes: 2 });
    expect(r.observations.rows.map((o) => [o.metric, o.value])).toEqual([["wind_speed", 6]]);
    expect(r.observations.init[0]).toMatchObject({ value: 3 }); // sea no se pidió
  });

  it("1m: lee las vistas de 1 min (último valor del minuto) y no tiene meta", async () => {
    const r = await readReplayRows(sql, {
      from: OLD,
      to: OLD + W,
      layers: ["bus", "bike", "weather"],
      resolution: "1m",
      lookbackMs,
      maxRows: 1000,
    });
    expect(r.resolution).toBe("1m");
    expect(r.positions.rows).toHaveLength(1);
    expect(r.positions.rows[0]).toMatchObject({ lon: -8.46, heading: 92, meta: null });
    expect(r.positions.rows[0]?.ts).toBe(OLD + MIN); // inicio del minuto
    expect(r.positions.init[0]?.ts).toBe(OLD - 2 * MIN);
    expect(r.stations.rows[0]).toMatchObject({ bikes: 9, ts: OLD + 3 * MIN });
    expect(r.observations.rows[0]).toMatchObject({ value: 7, ts: OLD + 2 * MIN });
  });

  it("maxRows marca el resultado como truncado", async () => {
    const r = await readReplayRows(sql, {
      from: RAW - 10 * MIN,
      to: RAW + 5 * MIN,
      layers: ["bus"],
      resolution: "raw",
      lookbackMs,
      maxRows: 1,
    });
    expect(r.truncated).toBe(true);
  });

  it("sin tablas ni vistas (ingesta sin migrar) = ventana vacía, no error", async () => {
    const bare = await createBareDb();
    try {
      for (const resolution of ["raw", "1m"] as const) {
        const r = await readReplayRows(bare.sql, {
          from: RAW,
          to: RAW + W,
          layers: ["bus", "bike", "air"],
          resolution,
          lookbackMs,
          maxRows: 10,
        });
        expect(r.positions.rows).toEqual([]);
        expect(r.observations.init).toEqual([]);
      }
    } finally {
      await bare.drop();
    }
  });

  it("de extremo a extremo por HTTP: MessagePack válido de datos recientes y antiguos", async () => {
    const { app } = await buildApp(testConfig(), new PgDataSource(sql, testConfig().maxAgeMs));
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const get = async (from: number) => {
        const r = await fetch(
          `${base}/api/v1/replay?from=${from}&to=${from + W}&layers=bus,bike,weather`,
        );
        expect(r.status).toBe(200);
        return ReplayWindowSchema.parse(decode(new Uint8Array(await r.arrayBuffer())));
      };
      const recent = await get(RAW);
      expect(recent.resolution).toBe("raw");
      expect(recent.layers.bus).toMatchObject({ kind: "mobile" });
      const old = await get(OLD);
      expect(old.resolution).toBe("1m");
      const bus = old.layers.bus;
      expect(bus?.kind === "mobile" && bus.tracks[0]?.ts).toEqual([MIN]);
    } finally {
      await app.close();
    }
  });
});
