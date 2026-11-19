import type { AddressInfo } from "node:net";
import { DeltaMessageSchema, SnapshotMessageSchema } from "@pulso/schema";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PgDataSource } from "../src/db.js";
import { testConfig, until } from "./helpers.js";
import { createBareDb, createTestDb, testDatabaseUrl } from "./test-db.js";

const MIN = 60_000;
const at = (msAgo: number): Date => new Date(Date.now() - msAgo);

// Se salta limpiamente sin Docker o con PULSO_TEST_DB=skip (ver test/global-setup.ts y ADR-0016).
describe.skipIf(!testDatabaseUrl)("PgDataSource + API sobre TimescaleDB (integración)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let source: PgDataSource;
  const cfg = testConfig();

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
    source = new PgDataSource(sql, cfg.maxAgeMs);
  });
  afterAll(async () => {
    await drop?.();
  });

  it("BD vacía: todas las capas vacías, sin error", async () => {
    const l = await source.latest();
    expect(Object.keys(l.layers)).toHaveLength(8);
    expect(Object.values(l.layers).every((x) => x.length === 0)).toBe(true);
    expect(await source.sourceHealth()).toEqual([]);
    expect(await source.layerFreshness()).toEqual({});
    expect(await source.ping()).toBeGreaterThanOrEqual(0);
  });

  it("último estado por clave, ventanas de antigüedad y mapeo válido para el contrato", async () => {
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:1', ${at(3 * MIN)}, 'bus', -8.40, 43.36, 90, 5, ${sql.json({ line: "1A" })}),
      ('bus:1', ${at(10_000)},   'bus', -8.41, 43.37, null, null, null),
      ('bus:old', ${at(20 * MIN)}, 'bus', -8.40, 43.36, null, null, null)`;
    await sql`insert into station_status (id, ts, layer, lon, lat, bikes, docks) values
      ('st:1', ${at(5 * MIN)}, 'bike', -8.4, 43.3, 2, 8),
      ('st:1', ${at(MIN)},     'bike', -8.4, 43.3, 4, 6),
      ('st:old', ${at(3 * 60 * MIN)}, 'bike', -8.4, 43.3, 1, 1)`;
    await sql`insert into observations (station_id, metric, ts, layer, value, unit) values
      ('m1', 'wind_speed', ${at(20 * MIN)}, 'weather', 3, 'm/s'),
      ('m1', 'wind_speed', ${at(10 * MIN)}, 'weather', 6, 'm/s'),
      ('m1', 'wind_dir',   ${at(10 * MIN)}, 'weather', 270, 'deg'),
      ('m2', 'wind_speed', ${at(10 * MIN)}, 'weather', 1, 'm/s')`;

    const l = await source.latest();
    expect(l.layers.bus).toHaveLength(1); // bus:old fuera de ventana
    expect(l.layers.bus[0]).toMatchObject({ id: "bus:1", lon: -8.41 });
    expect(l.layers.bus[0]).not.toHaveProperty("heading"); // null → ausente
    expect(l.layers.bike).toHaveLength(1);
    expect(l.layers.bike[0]).toMatchObject({ id: "st:1", bikes: 4 });
    expect(l.layers.weather).toHaveLength(3);
    expect(l.layers.sea).toEqual([]);

    const msg = {
      v: 1,
      type: "snapshot",
      ts: l.ts,
      layers: { bus: l.layers.bus, bike: l.layers.bike, weather: l.layers.weather },
    };
    expect(SnapshotMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("source_health y frescura por capa", async () => {
    await sql`insert into source_health (source_id, status, interval_ms, last_success_at, last_error_at,
      last_error, consecutive_failures, updated_at)
      values ('bicicoruna', 'ok', 60000, ${at(30_000)}, null, null, 0, ${at(30_000)}),
             ('meteogalicia', 'degraded', 600000, ${at(15 * MIN)}, ${at(MIN)}, 'timeout', 2, ${at(MIN)})`;
    const rows = await source.sourceHealth();
    expect(rows.map((r) => r.sourceId)).toEqual(["bicicoruna", "meteogalicia"]);
    expect(rows[1]).toMatchObject({ status: "degraded", consecutiveFailures: 2 });
    expect(rows[1]).not.toHaveProperty("lastError");
    const f = await source.layerFreshness();
    expect(Object.keys(f).sort()).toEqual(["bike", "bus", "weather"]);
    expect(f.bike).toBeGreaterThan(Date.now() - 2 * MIN);
  });

  it("sin tablas (la ingesta aún no migró) = sin datos, no error", async () => {
    const bare = await createBareDb();
    try {
      const s = new PgDataSource(bare.sql, cfg.maxAgeMs);
      const l = await s.latest();
      expect(Object.values(l.layers).every((x) => x.length === 0)).toBe(true);
      expect(await s.sourceHealth()).toEqual([]);
    } finally {
      await bare.drop();
    }
  });

  it("de extremo a extremo: HTTP + WS leyendo de la BD, delta al grabar la ingesta", async () => {
    const { app } = await buildApp(testConfig({ pollMs: 100 }), source);
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const port = (app.server.address() as AddressInfo).port;

      const snap = SnapshotMessageSchema.parse(
        await (await fetch(`http://127.0.0.1:${port}/api/v1/snapshot?layers=bus,bike,ship`)).json(),
      );
      expect(snap.layers.ship).toEqual([]);
      expect(snap.layers.bus).toHaveLength(1);

      const health = (await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json()) as {
        db: { ok: boolean };
        sources: unknown[];
      };
      expect(health.db.ok).toBe(true);
      expect(health.sources).toHaveLength(2);

      const messages: unknown[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/stream?layers=bus`);
      ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
      await until(() => messages.length >= 1);
      expect(SnapshotMessageSchema.parse(messages[0]).layers.bus).toHaveLength(1);

      await sql`insert into positions (id, ts, layer, lon, lat) values ('bus:2', now(), 'bus', -8.4, 43.3)`;
      await until(() => messages.length >= 2);
      const d = DeltaMessageSchema.parse(messages[1]);
      expect(d.layer).toBe("bus");
      expect(d.upserts).toHaveLength(1);
      ws.close();
    } finally {
      await app.close();
    }
  });
});
