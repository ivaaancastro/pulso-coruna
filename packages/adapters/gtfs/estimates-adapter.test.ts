import { EntitySchema } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import zipBase64 from "./fixtures/mini-gtfs.zip.b64?raw";
import {
  createScheduleEstimatesAdapter,
  readGtfsZip,
  scheduleEstimatesConfigFromEnv,
  scheduleEstimatesEnabled,
  type GtfsFiles,
} from "./index.js";

const files = (): Promise<GtfsFiles> =>
  readGtfsZip(Uint8Array.from(atob(zipBase64.trim()), (c) => c.charCodeAt(0)));

const MIN = 60_000;
const HOUR = 60 * MIN;
// Miércoles 2026-11-18 06:57 hora local (CET).
const T0 = Date.parse("2026-11-18T06:57:00+01:00");

function setup(opts: { fail?: number } = {}) {
  let clock = T0;
  let loads = 0;
  let toFail = opts.fail ?? 0;
  const adapter = createScheduleEstimatesAdapter({
    now: () => clock,
    load: async () => {
      loads++;
      if (toFail > 0) {
        toFail--;
        throw new Error("HTTP 503");
      }
      return files();
    },
  });
  const run = async () => adapter.parse(await adapter.fetch(new AbortController().signal));
  return {
    adapter,
    run,
    loads: () => loads,
    advance: (ms: number) => (clock += ms),
  };
}

describe("fuente bus-schedule", () => {
  it("emite entidades bus estimadas y válidas; intervalo entre 15 y 30 s", async () => {
    const { adapter, run } = setup();
    expect(adapter.id).toBe("bus-schedule");
    expect(adapter.intervalMs).toBeGreaterThanOrEqual(15_000);
    expect(adapter.intervalMs).toBeLessThanOrEqual(30_000);
    const rows = await run();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(EntitySchema.safeParse(r).success).toBe(true);
      expect(r).toMatchObject({ layer: "bus", meta: { estimated: 1, source: "schedule" } });
      expect(r.id.startsWith("sched:")).toBe(true);
    }
  });

  it("descarga el GTFS una sola vez, no por ciclo, y lo renueva a las 24 h", async () => {
    const { run, loads, advance } = setup();
    await run();
    advance(20_000);
    await run();
    advance(20_000);
    await run();
    expect(loads()).toBe(1);
    advance(24 * HOUR);
    await run(); // el modelo anterior sirve mientras llega la nueva descarga
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(loads()).toBe(2);
  });

  it("si la descarga falla, lanza y reintenta con backoff (sin red en cada ciclo)", async () => {
    const { run, loads, advance } = setup({ fail: 2 });
    await expect(run()).rejects.toThrow(/GTFS no disponible.*HTTP 503/);
    expect(loads()).toBe(1);
    advance(20_000); // dentro de la espera de 60 s: no vuelve a llamar
    await expect(run()).rejects.toThrow(/GTFS no disponible/);
    expect(loads()).toBe(1);
    advance(41_000); // pasados 60 s: segundo intento (falla) → espera de 120 s
    await expect(run()).rejects.toThrow(/GTFS no disponible/);
    expect(loads()).toBe(2);
    advance(100_000);
    await expect(run()).rejects.toThrow(/GTFS no disponible/);
    expect(loads()).toBe(2);
    advance(21_000); // pasados 120 s: tercer intento, ya bien
    expect((await run()).length).toBeGreaterThan(0);
    expect(loads()).toBe(3);
  });

  it("si falla la renovación conserva el feed anterior en memoria", async () => {
    let clock = T0;
    let calls = 0;
    const adapter = createScheduleEstimatesAdapter({
      now: () => clock,
      load: async () => {
        if (++calls > 1) throw new Error("HTTP 503");
        return files();
      },
    });
    const run = async () => adapter.parse(await adapter.fetch(new AbortController().signal));
    expect((await run()).length).toBeGreaterThan(0);
    clock = Date.parse("2026-11-19T06:57:00+01:00"); // 24 h después: toca renovar
    expect((await run()).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    expect((await run()).length).toBeGreaterThan(0); // sigue emitiendo con el feed anterior
  });

  it("feed caducado: no emite nada (la fuente lo señala como error)", async () => {
    const { run, advance } = setup();
    await run();
    advance(Date.parse("2027-01-04T06:57:00+01:00") - T0);
    await expect(run()).rejects.toThrow(/caducado/);
  });

  it("una cancelación del ciclo no tumba la descarga compartida", async () => {
    const { adapter, loads } = setup();
    const ctl = new AbortController();
    const p = adapter.fetch(ctl.signal);
    ctl.abort(new Error("timeout"));
    await expect(p).rejects.toThrow("timeout");
    const rows = adapter.parse(await adapter.fetch(new AbortController().signal));
    expect(rows.length).toBeGreaterThan(0);
    expect(loads()).toBe(1);
  });

  it("zip inválido o vacío cuenta como fallo de descarga", async () => {
    const adapter = createScheduleEstimatesAdapter({ now: () => T0, load: async () => ({}) });
    await expect(adapter.fetch(new AbortController().signal)).rejects.toThrow(/GTFS no disponible/);
  });
});

describe("configuración por entorno", () => {
  it("SCHEDULE_ESTIMATES_ENABLED: activa por defecto, solo se apaga con false/0/off", () => {
    expect(scheduleEstimatesEnabled({})).toBe(true);
    expect(scheduleEstimatesEnabled({ SCHEDULE_ESTIMATES_ENABLED: "true" })).toBe(true);
    expect(scheduleEstimatesEnabled({ SCHEDULE_ESTIMATES_ENABLED: "" })).toBe(true);
    for (const v of ["false", "0", "off", "FALSE"]) {
      expect(scheduleEstimatesEnabled({ SCHEDULE_ESTIMATES_ENABLED: v })).toBe(false);
    }
  });

  it("el intervalo nunca baja de 15 s", () => {
    const make = (env: Record<string, string>) =>
      createScheduleEstimatesAdapter(scheduleEstimatesConfigFromEnv(env)).intervalMs;
    expect(make({})).toBe(20_000);
    expect(make({ SCHEDULE_ESTIMATES_INTERVAL_MS: "30000" })).toBe(30_000);
    expect(make({ SCHEDULE_ESTIMATES_INTERVAL_MS: "1000" })).toBe(15_000);
    expect(make({ SCHEDULE_ESTIMATES_INTERVAL_MS: "x" })).toBe(20_000);
  });
});
