import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./client";
import { PULSE_STEP_MS, pulseWindow, type PulseData } from "./model";
import { createPulseWorkerFetcher, type PulseWorkerLike } from "./worker-bridge";
import {
  createPulseWorkerCore,
  type PulseWorkerInput,
  type PulseWorkerOutput,
} from "./worker-core";

const NOW = Date.parse("2026-11-19T12:03:27Z");
const W = pulseWindow(NOW);
const json = {
  v: 1,
  from: W.from,
  to: W.to,
  stepMs: PULSE_STEP_MS,
  profile: "fixed",
  points: [{ ts: W.to - PULSE_STEP_MS, value: 51, layers: {} }],
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function core(fetchImpl: FetchLike) {
  const out: PulseWorkerOutput[] = [];
  const handle = createPulseWorkerCore({ post: (m) => out.push(m), fetch: fetchImpl });
  return { out, handle };
}

describe("worker del índice (lógica)", () => {
  it("descarga, valida con PulseSchema y devuelve los datos", async () => {
    const { out, handle } = core(async () => ({ ok: true, status: 200, json: async () => json }));
    handle({ type: "fetch", id: 7, url: "/api/v1/pulse", window: W });
    await tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "data", id: 7, data: { profile: "fixed" } });
  });

  it("contrato roto, 503 y 400 → error / error / nodata", async () => {
    const res =
      (status: number, body: unknown): FetchLike =>
      async () => ({
        ok: status < 400,
        status,
        json: async () => body,
      });
    for (const [fetchImpl, kind] of [
      [res(200, { ...json, v: 9 }), "error"],
      [res(503, {}), "error"],
      [res(400, {}), "nodata"],
    ] as const) {
      const { out, handle } = core(fetchImpl);
      handle({ type: "fetch", id: 1, url: "/p", window: W });
      await tick();
      expect(out).toEqual([{ type: "error", id: 1, kind }]);
    }
  });

  it("cancel aborta la petición y no responde", async () => {
    let signal: AbortSignal | undefined;
    const { out, handle } = core(
      (_u, init) =>
        new Promise((_res, rej) => {
          signal = init?.signal;
          signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")));
        }),
    );
    handle({ type: "fetch", id: 3, url: "/p", window: W });
    handle({ type: "cancel", id: 3 });
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(out).toEqual([]);
  });
});

function fakeWorker() {
  const sent: PulseWorkerInput[] = [];
  const worker: PulseWorkerLike = {
    postMessage: (m) => sent.push(m),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
  };
  const reply = (m: PulseWorkerOutput): void =>
    worker.onmessage?.({ data: m } as MessageEvent<PulseWorkerOutput>);
  return { worker, sent, reply };
}

describe("puente con el worker", () => {
  const data: PulseData = { ...W, profile: "fixed", points: [] };

  it("resuelve con los datos y rechaza con el tipo de fallo", async () => {
    const { worker, sent, reply } = fakeWorker();
    const f = createPulseWorkerFetcher(worker);
    const ok = f.fetchWindow("/p", W, new AbortController().signal);
    expect(sent[0]).toMatchObject({ type: "fetch", id: 1, url: "/p" });
    reply({ type: "data", id: 1, data });
    await expect(ok).resolves.toEqual(data);
    const bad = f.fetchWindow("/p", W, new AbortController().signal);
    reply({ type: "error", id: 2, kind: "nodata" });
    await expect(bad).rejects.toMatchObject({ kind: "nodata" });
  });

  it("abortar cancela en el worker y rechaza; una respuesta tardía se ignora", async () => {
    const { worker, sent, reply } = fakeWorker();
    const f = createPulseWorkerFetcher(worker);
    const ctl = new AbortController();
    const p = f.fetchWindow("/p", W, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(sent[1]).toEqual({ type: "cancel", id: 1 });
    expect(() => reply({ type: "data", id: 1, data })).not.toThrow();
  });

  it("onerror / onmessageerror rechazan lo pendiente con error (no se queda cargando)", async () => {
    for (const hook of ["onerror", "onmessageerror"] as const) {
      const { worker } = fakeWorker();
      const f = createPulseWorkerFetcher(worker);
      const a = f.fetchWindow("/p", W, new AbortController().signal);
      const b = f.fetchWindow("/p", W, new AbortController().signal);
      worker[hook]?.(new Event("error"));
      await expect(a).rejects.toMatchObject({ name: "PulseFetchError", kind: "error" });
      await expect(b).rejects.toMatchObject({ kind: "error" });
    }
  });

  it("destroy termina el worker", () => {
    const { worker } = fakeWorker();
    createPulseWorkerFetcher(worker).destroy();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
