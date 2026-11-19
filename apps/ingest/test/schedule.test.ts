import { readFileSync } from "node:fs";
import {
  createBusEstimator,
  createScheduleEstimatesAdapter,
  readGtfsZip,
} from "@pulso/adapters/gtfs";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDataSource } from "../../api/src/db.js";
import { runCycle } from "../src/cycle.js";
import { migrate } from "../src/db/migrate.js";
import { PgStore } from "../src/db/store.js";
import { bus, makeDeps } from "./helpers.js";
import { createTestDb, testDatabaseUrl } from "./test-db.js";

const zip = readFileSync(
  new URL("../../../packages/adapters/gtfs/fixtures/mini-gtfs.zip.b64", import.meta.url),
  "utf8",
);
const loadFiles = () => readGtfsZip(Uint8Array.from(Buffer.from(zip.trim(), "base64")));

// Miércoles 2026-11-18, 06:57 hora local: viaje 100010650 en circulación.
const NOW = Date.parse("2026-11-18T06:57:00+01:00");
const newAdapter = () => createScheduleEstimatesAdapter({ now: () => NOW, load: loadFiles });

describe("bus-schedule en el ciclo de ingesta (memoria)", () => {
  it("escribe posiciones y deja su entrada en source_health", async () => {
    const { store, deps } = makeDeps();
    const out = await runCycle(newAdapter(), new AbortController().signal, deps);
    expect(out).toMatchObject({ ok: true, sourceId: "bus-schedule" });
    expect(out?.rowsWritten).toBeGreaterThan(0);
    expect(out?.rowsRejected).toBe(0);
    expect([...store.keys].every((k) => k.startsWith("p:sched:"))).toBe(true);
    expect(store.health.get("bus-schedule")).toMatchObject({ status: "ok", intervalMs: 20_000 });
  });

  it("feed caducado: el ciclo falla y la fuente lo refleja en source_health", async () => {
    const { store, deps } = makeDeps({ maxAttempts: 1 });
    const adapter = createScheduleEstimatesAdapter({
      now: () => Date.parse("2027-02-01T10:00:00+01:00"),
      load: loadFiles,
    });
    const out = await runCycle(adapter, new AbortController().signal, deps);
    expect(out?.ok).toBe(false);
    expect(store.health.get("bus-schedule")).toMatchObject({ status: "degraded" });
  });
});

describe.skipIf(!testDatabaseUrl)("bus-schedule + API (PostgreSQL)", () => {
  let sql: Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ sql, drop } = await createTestDb());
    await migrate(sql);
  });
  afterAll(async () => {
    await drop?.();
  });

  it("la API actual sirve lo escrito como capa bus, con meta de estimación, sin mezclar ids reales", async () => {
    const { deps } = makeDeps();
    const store = new PgStore(sql);
    // Una posición «real» (como las de iTranvías) conviviendo en la misma tabla.
    await store.write({ positions: [bus("4321", NOW)], stations: [], observations: [] });
    const out = await runCycle(newAdapter(), new AbortController().signal, { ...deps, store });
    expect(out?.ok).toBe(true);

    const expected = createBusEstimator(await loadFiles()).estimate(NOW);
    expect(expected.length).toBeGreaterThan(0);

    const api = new PgDataSource(
      sql,
      { entity: 300_000, station: 3_600_000, observation: 21_600_000 },
      () => NOW + 1_000,
    );
    const { layers } = await api.latest();
    const sched = layers.bus.filter((e) => "id" in e && e.id.startsWith("sched:"));
    expect(sched).toEqual(expected);
    expect(layers.bus.some((e) => "id" in e && e.id === "4321")).toBe(true);

    const health = await api.sourceHealth();
    expect(health.find((h) => h.sourceId === "bus-schedule")).toMatchObject({ status: "ok" });
  });
});
