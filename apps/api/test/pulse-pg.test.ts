import type { AddressInfo } from "node:net";
import { PulseSchema } from "@pulso/schema";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PgDataSource } from "../src/db.js";
import { readPulseAggregates } from "../src/pulse-db.js";
import { PULSE_LAYERS } from "../src/pulse.js";
import { replayCutoff } from "../src/replay.js";
import { testConfig } from "./helpers.js";
import { createBareDb, createTestDb, testDatabaseUrl } from "./test-db.js";

const MIN = 60_000;
const STEP = 5 * MIN;
const DAY = 86_400_000;
const align = (ms: number): number => Math.floor(ms / STEP) * STEP;
const RAW = align(Date.now() - 3 * 60 * MIN); // reciente (datos brutos)
const CUT = replayCutoff(Date.now(), 30);
const OLD = align(Date.now() - 40 * DAY); // antiguo (solo vistas de 1 min)
const d = (ms: number): Date => new Date(ms);
const layers = [...PULSE_LAYERS];
const byIdx = <T extends { idx: number }>(a: T[]): T[] => [...a].sort((x, y) => x.idx - y.idx);

// Se salta sin Docker o con PULSO_TEST_DB=skip (ver test/global-setup.ts y ADR-0016).
describe.skipIf(!testDatabaseUrl)("pulse sobre TimescaleDB (integración)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
    // --- brutos recientes ---
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:1', ${d(RAW + 10_000)}, 'bus', -8.40, 43.36, null, 5, null),
      ('bus:1', ${d(RAW + 40_000)}, 'bus', -8.41, 43.36, null, 6, null),
      ('bus:2', ${d(RAW + 20_000)}, 'bus', -8.40, 43.37, null, 0, null),
      ('bus:3', ${d(RAW + 30_000)}, 'bus', -8.40, 43.38, null, null, null),
      ('bus:1', ${d(RAW + STEP + 5_000)}, 'bus', -8.42, 43.36, null, 4, null),
      ('ship:1', ${d(RAW + 1_000)}, 'ship', -8.30, 43.40, null, 0.1, null),
      ('bus:fuera', ${d(RAW + 2 * STEP)}, 'bus', -8.4, 43.3, null, 9, null)`;
    await sql`insert into station_status (id, ts, layer, lon, lat, bikes, docks) values
      ('st:1', ${d(RAW - 5 * MIN)}, 'bike', -8.4, 43.3, 5, 15),
      ('st:1', ${d(RAW + MIN)},     'bike', -8.4, 43.3, 8, 12),
      ('st:1', ${d(RAW + 2 * MIN)}, 'bike', -8.4, 43.3, 6, 14),
      ('st:2', ${d(RAW - 60 * MIN)}, 'bike', -8.4, 43.4, 3, 17),
      ('st:2', ${d(RAW + MIN)},     'bike', -8.4, 43.4, 10, 10),
      ('st:2', ${d(RAW + 6 * MIN)}, 'bike', -8.4, 43.4, 11, 9)`;
    await sql`insert into observations (station_id, metric, ts, layer, value, unit) values
      ('m1', 'wind_speed', ${d(RAW + MIN)}, 'weather', 8, 'm/s'),
      ('m1', 'wind_speed', ${d(RAW + 2 * MIN)}, 'weather', 4, 'm/s'),
      ('m1', 'wind_dir', ${d(RAW + MIN)}, 'weather', 270, 'deg'),
      ('p1', 'tide_level', ${d(RAW + 7 * MIN)}, 'sea', 3.2, 'm'),
      ('a1', 'pm10', ${d(RAW - 5 * MIN)}, 'air', 99, 'ug/m3')`;
    // --- antiguos: solo cuentan las vistas de 1 min (dos muestras en el mismo minuto → la última) ---
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:1', ${d(OLD + 10_000)}, 'bus', -8.40, 43.36, null, 0, null),
      ('bus:1', ${d(OLD + 40_000)}, 'bus', -8.41, 43.36, null, 5, null)`;
    await sql`insert into station_status (id, ts, layer, lon, lat, bikes, docks) values
      ('st:1', ${d(OLD - MIN)}, 'bike', -8.4, 43.3, 4, 16),
      ('st:1', ${d(OLD + MIN)}, 'bike', -8.4, 43.3, 9, 11)`;
    await sql`insert into observations (station_id, metric, ts, layer, value, unit) values
      ('m1', 'wind_speed', ${d(OLD + MIN)}, 'weather', 7, 'm/s')`;
    // --- alrededor del corte raw/1m ---
    await sql`insert into positions (id, ts, layer, lon, lat, heading, speed, meta) values
      ('bus:x', ${d(CUT - 2 * MIN + 5000)}, 'bus', -8.50, 43.50, null, 5, null),
      ('bus:x', ${d(CUT + 20_000)}, 'bus', -8.51, 43.51, null, 5, null),
      ('bus:x', ${d(CUT + 80_000)}, 'bus', -8.52, 43.52, null, 5, null)`;
    const refresh = async (view: string, at: number): Promise<void> => {
      await sql.unsafe(
        `call refresh_continuous_aggregate('${view}', '${d(at - 10 * MIN).toISOString()}', '${d(at + 10 * MIN).toISOString()}')`,
      );
    };
    await refresh("positions_1m", CUT);
    for (const v of ["positions_1m", "station_status_1m", "observations_1m"]) await refresh(v, OLD);
  });
  afterAll(async () => {
    await drop?.();
  });

  it("raw: entidades distintas en movimiento, rotación de bicis y medias ambientales por tramo", async () => {
    const r = await readPulseAggregates(sql, {
      from: RAW,
      to: RAW + 2 * STEP,
      stepMs: STEP,
      layers,
      cutoff: CUT,
    });
    // tramo 0: bus:1 (2 muestras = 1), bus:3 (velocidad desconocida) cuentan; bus:2 parado no.
    expect(byIdx(r.mobile.filter((m) => m.layer === "bus"))).toEqual([
      { layer: "bus", idx: 0, moving: 2 },
      { layer: "bus", idx: 1, moving: 1 },
    ]);
    // el barco parado cuenta como capa viva con 0 en movimiento
    expect(r.mobile.filter((m) => m.layer === "ship")).toEqual([
      { layer: "ship", idx: 0, moving: 0 },
    ]);
    // st:1: |8−5| + |6−8| = 5 (el 5 previo está dentro del hueco máximo); st:2: el salto de 60 min no cuenta
    // tramo 1: st:2 11−10 = 1
    expect(byIdx(r.bike)).toEqual([
      { idx: 0, rotation: 5 },
      { idx: 1, rotation: 1 },
    ]);
    // solo métricas conocidas (wind_dir fuera) y solo dentro de la ventana (pm10 de antes de `from` fuera)
    expect(byIdx(r.obs).map((o) => [o.layer, o.metric, o.idx, o.avg])).toEqual([
      ["weather", "wind_speed", 0, 6],
      ["sea", "tide_level", 1, 3.2],
    ]);
  });

  it("solo lee las capas activas", async () => {
    const r = await readPulseAggregates(sql, {
      from: RAW,
      to: RAW + 2 * STEP,
      stepMs: STEP,
      layers: ["bus"],
      cutoff: CUT,
    });
    expect(r.mobile.every((m) => m.layer === "bus")).toBe(true);
    expect(r.bike).toEqual([]);
    expect(r.obs).toEqual([]);
  });

  it("1m: datos antiguos salen de las vistas (último valor del minuto)", async () => {
    const r = await readPulseAggregates(sql, {
      from: OLD,
      to: OLD + STEP,
      stepMs: STEP,
      layers,
      cutoff: CUT,
    });
    expect(r.mobile).toEqual([{ layer: "bus", idx: 0, moving: 1 }]); // la última muestra del minuto: 5 m/s
    expect(r.bike).toEqual([{ idx: 0, rotation: 5 }]); // 9 − 4 (lectura previa de la vista, a 2 min)
    expect(r.obs).toEqual([{ layer: "weather", metric: "wind_speed", idx: 0, avg: 7 }]);
  });

  it("ventana que cruza el corte: vistas antes, brutos después, sin duplicar", async () => {
    const r = await readPulseAggregates(sql, {
      from: CUT - 3 * MIN,
      to: CUT + 2 * MIN,
      stepMs: MIN,
      layers: ["bus"],
      cutoff: CUT,
    });
    expect(byIdx(r.mobile).map((m) => [m.idx, m.moving])).toEqual([
      [1, 1], // CUT−2 min (vista)
      [3, 1], // CUT+20 s (bruto)
      [4, 1], // CUT+80 s (bruto)
    ]);
  });

  it("ventana vacía y BD sin tablas = agregados vacíos, no error", async () => {
    const q = {
      from: RAW - 20 * DAY,
      to: RAW - 20 * DAY + STEP,
      stepMs: STEP,
      layers,
      cutoff: CUT,
    };
    expect(await readPulseAggregates(sql, q)).toEqual({ mobile: [], bike: [], obs: [] });
    const bare = await createBareDb();
    try {
      expect(await readPulseAggregates(bare.sql, { ...q, from: RAW, to: RAW + STEP })).toEqual({
        mobile: [],
        bike: [],
        obs: [],
      });
    } finally {
      await bare.drop();
    }
  });

  it("de extremo a extremo por HTTP: serie válida de datos recientes y antiguos", async () => {
    const cfg = testConfig();
    const { app } = await buildApp(cfg, new PgDataSource(sql, cfg.maxAgeMs));
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const get = async (from: number) => {
        const r = await fetch(`${base}/api/v1/pulse?from=${from}&to=${from + 3600_000}`);
        expect(r.status).toBe(200);
        return PulseSchema.parse(await r.json());
      };
      const recent = await get(RAW);
      expect(recent.profile).toBe("fixed");
      expect(recent.points[0]?.ts).toBe(RAW);
      expect(Object.keys(recent.points[0]?.layers ?? {}).sort()).toEqual(
        ["bike", "bus", "ship", "weather"].sort(),
      );
      const old = await get(OLD);
      expect(old.points.length).toBeGreaterThan(0);
      expect(old.points[0]?.layers.bus).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
