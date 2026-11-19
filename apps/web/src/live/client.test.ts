import { describe, expect, it } from "vitest";
import { createLiveClient, type MotionQueryLike, type WorkerLike } from "./client";
import type { MobileFrame, WorkerInput, WorkerOutput } from "./types";
import { T0, bus } from "./test-helpers";

class FakeWorker implements WorkerLike {
  sent: WorkerInput[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null = null;
  postMessage(m: WorkerInput): void {
    this.sent.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(out: WorkerOutput): void {
    this.onmessage?.({ data: out } as MessageEvent<WorkerOutput>);
  }
}

class FakeMotion implements MotionQueryLike {
  listeners = new Set<() => void>();
  constructor(public matches = false) {}
  addEventListener(_: "change", l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_: "change", l: () => void): void {
    this.listeners.delete(l);
  }
  set(v: boolean): void {
    this.matches = v;
    for (const l of this.listeners) l();
  }
}

function setup(reduced = false) {
  const worker = new FakeWorker();
  const motion = new FakeMotion(reduced);
  const frames: (() => void)[] = [];
  let now = T0;
  const client = createLiveClient({
    worker,
    url: "ws://x/api/v1/stream",
    now: () => now,
    motion,
    raf: (cb) => {
      frames.push(cb);
      return () => {
        const i = frames.indexOf(cb);
        if (i >= 0) frames.splice(i, 1);
      };
    },
  });
  const runFrame = (): void => frames.shift()?.();
  return {
    worker,
    motion,
    client,
    runFrame,
    setNow: (n: number) => (now = n),
    get queued() {
      return frames.length;
    },
  };
}

const frame = (over: Partial<MobileFrame> = {}): MobileFrame => ({
  layer: "bus",
  count: 1,
  idsVersion: 1,
  ids: ["a"],
  positions: new Float32Array([-8.4, 43.37]),
  headings: new Float32Array([90]),
  ...over,
});

describe("cliente del hilo principal", () => {
  it("init con URL, hora de la app y preferencia de movimiento", () => {
    const { client, worker } = setup(true);
    client.start();
    expect(worker.sent[0]).toEqual({
      type: "init",
      url: "ws://x/api/v1/stream",
      now: T0,
      reducedMotion: true,
    });
  });

  it("un tick por fotograma con el reloj de la app; no apila si el worker no contestó", () => {
    const { client, worker, runFrame, setNow } = setup();
    client.start();
    runFrame();
    setNow(T0 + 16);
    runFrame(); // el worker aún no respondió: no se envía otro tick
    expect(worker.sent.filter((m) => m.type === "tick")).toEqual([{ type: "tick", now: T0 }]);
    worker.emit({ type: "frames", frames: [] });
    setNow(T0 + 32);
    runFrame();
    expect(worker.sent.filter((m) => m.type === "tick").at(-1)).toEqual({
      type: "tick",
      now: T0 + 32,
    });
  });

  it("refleja en el almacén estado, items, fotogramas, frescura y rechazos", () => {
    const { client, worker } = setup();
    const seen: string[] = [];
    client.store.subscribe((c) => seen.push(c.kind));
    client.start();
    worker.emit({ type: "status", state: "open", attempt: 0 });
    worker.emit({
      type: "items",
      layer: "bus",
      replace: true,
      upserts: [bus("a")],
      removes: [],
      receivedAt: T0 + 5,
      dataTs: T0,
    });
    worker.emit({ type: "frames", frames: [frame()] });
    worker.emit({ type: "frames", frames: [frame({ ids: null, count: 1 })] });
    worker.emit({ type: "rejected", total: 2 });
    const s = client.store;
    expect(s.connection).toEqual({ state: "open", attempt: 0 });
    expect(s.items("bus").size).toBe(1);
    expect(s.freshness("bus")).toEqual({ receivedAt: T0 + 5, dataTs: T0 });
    expect(s.frame("bus")?.ids).toEqual(["a"]); // se conservan los ids anteriores
    expect(s.rejected).toBe(2);
    expect(seen).toEqual(["connection", "items", "frames", "frames"]);
  });

  it("reduced-motion: cadencia lenta y aviso al worker; vuelve a rAF al desactivarlo", () => {
    const h = setup();
    const { client, worker, motion } = h;
    client.start();
    expect(h.queued).toBe(1);
    motion.set(true);
    expect(worker.sent.at(-1)).toEqual({ type: "reducedMotion", value: true });
    expect(h.queued).toBe(0); // rAF cancelado: ahora manda el temporizador
    motion.set(false);
    expect(worker.sent.at(-1)).toEqual({ type: "reducedMotion", value: false });
  });

  it("stop cierra y termina el worker, y deja de pedir fotogramas", () => {
    const h = setup();
    const { client, worker } = h;
    client.start();
    client.stop();
    expect(worker.sent.at(-1)).toEqual({ type: "close" });
    expect(worker.terminated).toBe(true);
    expect(h.queued).toBe(0);
  });
});
