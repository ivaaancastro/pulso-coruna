import { describe, expect, it } from "vitest";
import { runCycle } from "../src/cycle.js";
import { fail, fakeAdapter, makeDeps, ok, station } from "./helpers.js";

/** Lanza el ciclo sin esperarlo, para poder avanzar el reloj falso mientras corre. */
const start = (...args: Parameters<typeof runCycle>) => {
  const p = runCycle(...args);
  return p;
};

describe("runCycle: reintentos con espera creciente", () => {
  it("reintenta con 1 s y 2 s de espera y acaba bien al tercer intento", async () => {
    const { clock, store, deps } = makeDeps();
    const adapter = fakeAdapter({ script: [fail("a"), fail("b"), ok([station("s1")])] });
    const p = start(adapter, new AbortController().signal, deps);

    await clock.advance(0);
    expect(adapter.calls).toBe(1);
    await clock.advance(999);
    expect(adapter.calls).toBe(1); // aún esperando el primer backoff (1000 ms)
    await clock.advance(1);
    expect(adapter.calls).toBe(2);
    await clock.advance(1999);
    expect(adapter.calls).toBe(2); // segundo backoff: 2000 ms
    await clock.advance(1);
    expect(adapter.calls).toBe(3);

    const outcome = await p;
    expect(outcome).toMatchObject({ ok: true, rowsWritten: 1 });
    expect(store.health.get("fake")).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
      rowsWrittenLast: 1,
      rowsWrittenTotal: 1,
    });
  });

  it("agotados los intentos registra un fallo de ciclo (no uno por intento)", async () => {
    const { clock, store, deps } = makeDeps();
    const adapter = fakeAdapter({ script: [fail("caída")] });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(10_000);
    expect(await p).toMatchObject({ ok: false, error: "caída" });
    expect(adapter.calls).toBe(3);
    expect(store.health.get("fake")).toMatchObject({
      status: "degraded",
      consecutiveFailures: 1,
      lastError: "caída",
    });
  });

  it("un intento que no responde se corta por timeout y la señal se aborta", async () => {
    const { clock, deps } = makeDeps({ maxAttempts: 1 });
    let seen: AbortSignal | undefined;
    const adapter = fakeAdapter({
      script: [
        (signal) => {
          seen = signal;
          return new Promise(() => {}); // nunca responde
        },
      ],
    });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(4_999);
    expect(seen?.aborted).toBe(false);
    await clock.advance(1);
    expect(seen?.aborted).toBe(true);
    expect(await p).toMatchObject({ ok: false, error: expect.stringContaining("timeout") });
  });

  it("si todas las filas incumplen el contrato, el ciclo falla", async () => {
    const { clock, store, deps } = makeDeps({ maxAttempts: 1 });
    const adapter = fakeAdapter({ script: [ok([{ ...station("s"), bikes: -1 }])] });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(0);
    expect(await p).toMatchObject({ ok: false });
    expect(store.keys.size).toBe(0);
    expect(store.health.get("fake")?.status).toBe("degraded");
  });

  it("filas válidas e inválidas mezcladas: escribe las válidas y cuenta las rechazadas", async () => {
    const { clock, store, deps } = makeDeps({ maxAttempts: 1 });
    const adapter = fakeAdapter({ script: [ok([station("s"), { ...station("t"), bikes: -1 }])] });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(0);
    expect(await p).toMatchObject({ ok: true, rowsWritten: 1, rowsRejected: 1 });
    expect(store.health.get("fake")?.rowsRejectedLast).toBe(1);
  });

  it("al detenerse durante la espera devuelve null y no toca source_health", async () => {
    const { clock, store, deps } = makeDeps();
    const stop = new AbortController();
    const adapter = fakeAdapter({ script: [fail("x")] });
    const p = start(adapter, stop.signal, deps);
    await clock.advance(0);
    stop.abort();
    expect(await p).toBeNull();
    expect(store.health.size).toBe(0);
  });

  it("un fallo de la BD no degrada la fuente: reintenta la escritura con backoff", async () => {
    const { clock, store, deps } = makeDeps();
    let attempts = 0;
    const realWrite = store.write.bind(store);
    store.write = async (rows) => {
      if (++attempts < 3) throw new Error("conexión perdida");
      return realWrite(rows);
    };
    const adapter = fakeAdapter({ script: [ok([station("s1")])] });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(1_000 + 2_000);
    expect(await p).toMatchObject({ ok: true, rowsWritten: 1 });
    expect(attempts).toBe(3);
    expect(adapter.calls).toBe(1); // no se vuelve a pedir a la fuente
    expect(store.health.get("fake")).toMatchObject({ status: "ok", consecutiveFailures: 0 });
  });

  it("si la BD sigue caída, la fuente sigue ok y el error de BD se informa aparte", async () => {
    const { clock, store, deps } = makeDeps();
    store.write = async () => {
      throw new Error("BD caída");
    };
    const adapter = fakeAdapter({ script: [ok([station("s1")])] });
    const p = start(adapter, new AbortController().signal, deps);
    await clock.advance(10_000);
    expect(await p).toMatchObject({ ok: true, rowsWritten: 0, storageError: "BD caída" });
    expect(store.health.get("fake")).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
      lastError: null,
    });
  });
});
