import { describe, expect, it } from "vitest";
import { startScheduler } from "../src/scheduler.js";
import { fail, fakeAdapter, makeDeps, ok, station, type Step } from "./helpers.js";

describe("startScheduler", () => {
  it("ejecuta el adaptador cada intervalMs, empezando de inmediato", async () => {
    const { clock, store, deps } = makeDeps();
    const adapter = fakeAdapter({ intervalMs: 60_000, script: [ok([station("s")])] });
    const s = startScheduler([adapter], deps);
    await clock.advance(0);
    expect(adapter.calls).toBe(1);
    await clock.advance(59_999);
    expect(adapter.calls).toBe(1);
    await clock.advance(1);
    expect(adapter.calls).toBe(2);
    await clock.advance(60_000);
    expect(adapter.calls).toBe(3);
    expect(store.health.get("fake")?.status).toBe("ok");
    await s.stop();
  });

  it("no solapa ciclos del mismo adaptador aunque tarde más que el intervalo", async () => {
    const { clock, deps } = makeDeps({ timeoutMs: 100_000 });
    let running = 0;
    let maxRunning = 0;
    const slow: Step = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await clock.sleep(25_000); // tarda 2,5 intervalos
      running--;
      return [station("s")];
    };
    const adapter = fakeAdapter({ intervalMs: 10_000, script: [slow] });
    const s = startScheduler([adapter], deps);
    await clock.advance(100_000);
    expect(maxRunning).toBe(1);
    expect(adapter.calls).toBe(5); // t=0, 25, 50, 75, 100 (cada uno empieza al acabar el anterior)
    await s.stop();
  });

  it("adaptadores distintos son independientes: uno lento no frena al otro", async () => {
    const { clock, deps } = makeDeps({ timeoutMs: 100_000 });
    const slow = fakeAdapter({
      id: "slow",
      intervalMs: 1_000,
      script: [async () => (await clock.sleep(50_000), [station("a")])],
    });
    const fast = fakeAdapter({ id: "fast", intervalMs: 1_000, script: [ok([station("b")])] });
    const s = startScheduler([slow, fast], deps);
    await clock.advance(10_000);
    expect(fast.calls).toBe(11);
    expect(slow.calls).toBe(1);
    await s.stop();
  });

  it("source_health recorre ok → degraded → down → ok", async () => {
    const { clock, store, deps } = makeDeps({ maxAttempts: 1, downAfter: 3 });
    const adapter = fakeAdapter({
      intervalMs: 1_000,
      script: [
        ok([station("s")]),
        fail("e1"),
        fail("e2"),
        fail("e3"),
        ok([station("s", 1_760_000_100_000)]),
      ],
    });
    const s = startScheduler([adapter], deps);
    const statuses: string[] = [];
    for (let i = 0; i < 5; i++) {
      await clock.advance(i === 0 ? 0 : 1_000);
      statuses.push(store.health.get("fake")?.status ?? "none");
    }
    expect(statuses).toEqual(["ok", "degraded", "degraded", "down", "ok"]);
    expect(store.health.get("fake")).toMatchObject({
      consecutiveFailures: 0,
      lastError: "e3",
      rowsWrittenTotal: 2,
    });
    await s.stop();
  });

  it("stop() aborta esperas e intentos en vuelo y termina", async () => {
    const { clock, deps } = makeDeps();
    let aborted = false;
    const adapter = fakeAdapter({
      script: [
        (signal) =>
          new Promise(() => {
            signal.addEventListener("abort", () => (aborted = true));
          }),
      ],
    });
    const s = startScheduler([adapter], deps);
    await clock.advance(10);
    await s.stop();
    expect(aborted).toBe(true);
    const calls = adapter.calls;
    await clock.advance(10 * 60_000);
    expect(adapter.calls).toBe(calls);
  });

  it("rechaza ids duplicados", () => {
    const { deps } = makeDeps();
    const a = fakeAdapter({ script: [ok([])] });
    expect(() => startScheduler([a, a], deps)).toThrow(/duplicado/);
  });
});
