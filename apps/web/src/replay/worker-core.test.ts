import type { ReplayWindow } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import type { WorkerOutput } from "../live/types";
import type { LoadResult } from "./loader";
import { W0, mobileWindow } from "./test-helpers";
import { createReplayWorkerCore } from "./worker-core";
import { WINDOW_MS } from "./windows";

interface Pending {
  from: number;
  signal: AbortSignal;
  resolve: (r: LoadResult) => void;
}

function setup(opts: { maxConcurrent?: number; debounceMs?: number } = {}) {
  const out: WorkerOutput[] = [];
  const requested: number[] = [];
  const pending: Pending[] = [];
  let clock = 1000;
  const core = createReplayWorkerCore({
    post: (m) => out.push(m),
    createLoader: () => ({
      load: (from, signal) =>
        new Promise<LoadResult>((resolve) => {
          requested.push(from);
          pending.push({ from, signal, resolve });
          signal.addEventListener("abort", () => resolve({ ok: false, reason: "aborted" }));
        }),
    }),
    clock: () => clock,
    ...opts,
  });
  const win = (from: number): ReplayWindow =>
    mobileWindow(from, "bus", [
      {
        id: "b",
        samples: [
          { ts: 1000, lon: -8.4, lat: 43.37 },
          { ts: 200_000, lon: -8.39, lat: 43.37 },
        ],
      },
    ]);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const answer = async (
    from: number,
    result: LoadResult = { ok: true, window: win(from), bytes: 100 },
  ) => {
    const p = [...pending].reverse().find((x) => x.from === from && !x.signal.aborted);
    p?.resolve(result);
    await flush();
  };
  const status = () => [...out].reverse().find((m) => m.type === "replay");
  return {
    core,
    out,
    requested,
    pending,
    win,
    answer,
    status,
    advance: (ms: number) => (clock += ms),
    tick: (now: number) => core({ type: "tick", now }),
    init: () =>
      core({ type: "init", url: "http://x/api/v1/replay", now: W0, reducedMotion: false }),
  };
}

describe("worker de reproducción", () => {
  it("siempre contesta a un tick con `frames` (el cliente espera esa respuesta)", () => {
    const s = setup();
    s.core({ type: "tick", now: W0 }); // aún sin init
    s.init();
    s.tick(W0);
    expect(s.out.filter((m) => m.type === "frames")).toHaveLength(2);
  });

  it("pide la ventana del instante y la siguiente; mientras tanto informa de «cargando»", () => {
    const s = setup();
    s.init();
    s.tick(W0 + 10_000);
    expect(s.requested.slice(0, 2)).toEqual([W0, W0 + WINDOW_MS]);
    expect(s.status()).toMatchObject({ status: { loading: true, error: null } });
  });

  it("con la ventana cargada emite reset, elementos y fotograma; ya no está cargando", async () => {
    const s = setup();
    s.init();
    s.tick(W0 + 10_000);
    await s.answer(W0);
    s.advance(16);
    s.tick(W0 + 10_000);
    const types = s.out.map((m) => m.type);
    expect(types).toContain("reset");
    expect(types).toContain("items");
    const frames = s.out.filter((m) => m.type === "frames").at(-1);
    expect(frames && frames.type === "frames" && frames.frames[0]?.count).toBe(1);
    expect(s.status()).toMatchObject({
      status: { loading: false, noData: false, resolution: "raw" },
    });
  });

  it("no pasa de maxConcurrent peticiones a la vez", () => {
    const s = setup({ maxConcurrent: 2 });
    s.init();
    s.tick(W0);
    s.tick(W0 + 1);
    expect(s.pending).toHaveLength(2);
  });

  it("precarga hacia delante según la velocidad (600× → varias ventanas por delante)", async () => {
    const s = setup({ maxConcurrent: 10 });
    s.init();
    // Reloj a 600×: 16 ms reales = 9,6 s de reproducción por tick.
    let now = W0;
    for (let i = 0; i < 4; i++) {
      s.advance(16);
      now += 9_600;
      s.tick(now);
    }
    const ahead = s.requested.filter((f) => f > W0 + WINDOW_MS);
    expect(ahead.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...s.requested)).toBeGreaterThan(W0 + 3 * WINDOW_MS);
    // Y no se va hacia atrás más allá de la vecina inmediata.
    expect(s.requested.filter((f) => f < W0 - WINDOW_MS)).toHaveLength(0);
  });

  it("al ir hacia atrás precarga las anteriores", () => {
    const s = setup({ maxConcurrent: 10 });
    s.init();
    let now = W0 + 20 * WINDOW_MS;
    for (let i = 0; i < 4; i++) {
      s.advance(16);
      now -= 9_600;
      s.tick(now);
    }
    expect(s.requested.some((f) => f < W0 + 20 * WINDOW_MS)).toBe(true);
    expect(s.requested.some((f) => f > W0 + 21 * WINDOW_MS)).toBe(false);
  });

  it("tras un salto grande (arrastre) espera el debounce antes de pedir y cancela lo que ya no hace falta", () => {
    const s = setup({ debounceMs: 120 });
    s.init();
    s.tick(W0);
    const first = [...s.pending];
    expect(first.length).toBeGreaterThan(0);
    s.advance(16);
    s.tick(W0 + 50 * WINDOW_MS); // salto lejano
    expect(first.every((p) => p.signal.aborted)).toBe(true);
    const before = s.requested.length;
    s.advance(50);
    s.tick(W0 + 50 * WINDOW_MS);
    expect(s.requested).toHaveLength(before); // aún dentro del debounce
    s.advance(100);
    s.tick(W0 + 50 * WINDOW_MS);
    expect(s.requested.slice(before)[0]).toBe(W0 + 50 * WINDOW_MS);
  });

  it("un fallo se publica y se reintenta pasado el enfriamiento; mientras falla no calcula nada", async () => {
    const s = setup();
    s.init();
    s.tick(W0);
    await s.answer(W0, { ok: false, reason: "network" });
    const n = s.requested.length;
    s.advance(16);
    s.tick(W0);
    expect(s.status()).toMatchObject({ status: { loading: true, error: "network" } });
    expect(s.requested).toHaveLength(n); // enfriamiento
    s.advance(5000);
    s.tick(W0);
    expect(s.requested.filter((f) => f === W0).length).toBe(2);
    await s.answer(W0);
    s.advance(16);
    s.tick(W0);
    expect(s.status()).toMatchObject({ status: { loading: false, error: null } });
  });

  it("ventana sin datos: noData; con cualquier dato, no", async () => {
    const s = setup();
    s.init();
    s.tick(W0);
    await s.answer(W0, {
      ok: true,
      window: { v: 1, from: W0, to: W0 + WINDOW_MS, resolution: "1m", layers: {} },
      bytes: 10,
    });
    s.advance(16);
    s.tick(W0);
    expect(s.status()).toMatchObject({ status: { noData: true, resolution: "1m" } });
  });

  it("no repite el estado si no cambia", async () => {
    const s = setup();
    s.init();
    s.tick(W0);
    await s.answer(W0);
    for (let i = 0; i < 5; i++) {
      s.advance(16);
      s.tick(W0 + 10_000 + i);
    }
    const statuses = s.out.filter((m) => m.type === "replay");
    expect(statuses.length).toBeLessThanOrEqual(2);
  });

  it("close cancela las peticiones en vuelo", () => {
    const s = setup();
    s.init();
    s.tick(W0);
    s.core({ type: "close" });
    expect(s.pending.every((p) => p.signal.aborted)).toBe(true);
  });
});
