import { describe, expect, it } from "vitest";
import type { WorkerOutput } from "./types";
import { FakeSocket, T0, bus, delta, manualTimers, snapshot, station } from "./test-helpers";
import { createWorkerCore } from "./worker-core";

function setup() {
  const out: { message: WorkerOutput; transfer: ArrayBuffer[] }[] = [];
  const sockets: FakeSocket[] = [];
  const timers = manualTimers();
  const handle = createWorkerCore({
    post: (message, transfer) => out.push({ message, transfer }),
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    random: () => 1,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  handle({ type: "init", url: "ws://x/api/v1/stream", now: T0, reducedMotion: false });
  const of = <K extends WorkerOutput["type"]>(type: K) =>
    out
      .map((o) => o.message)
      .filter((m): m is Extract<WorkerOutput, { type: K }> => m.type === type);
  return { out, sockets, timers, handle, of };
}

describe("worker core", () => {
  it("valida cada mensaje: los inválidos se cuentan y no tocan el estado", () => {
    const { sockets, of } = setup();
    const s = sockets[0] as FakeSocket;
    s.open();
    s.receive(JSON.stringify(snapshot({ bus: [bus("a")] })));
    s.receive("{roto");
    s.receive(JSON.stringify(delta("bike", [bus("x")]))); // elemento de otra capa
    s.receive(new ArrayBuffer(2));
    expect(of("rejected").at(-1)?.total).toBe(3);
    expect(of("items").map((i) => i.layer)).toEqual(["bus"]);
  });

  it("snapshot y deltas llegan como items; el tick devuelve buffers transferibles", () => {
    const { sockets, of, handle, out } = setup();
    const s = sockets[0] as FakeSocket;
    s.open();
    s.receive(JSON.stringify(snapshot({ bus: [bus("a")], bike: [station("s1")] })));
    s.receive(JSON.stringify(delta("bike", [station("s1", { bikes: 9, ts: T0 + 1 })])));
    const items = of("items");
    expect(items.map((i) => [i.layer, i.replace])).toEqual([
      ["bus", true],
      ["bike", true],
      ["bike", false],
    ]);
    handle({ type: "tick", now: T0 + 16 });
    const last = out.at(-1);
    const frames = of("frames").at(-1)?.frames ?? [];
    expect(frames).toHaveLength(1);
    expect(last?.transfer).toHaveLength(2);
    expect(last?.transfer[0]).toBe(frames[0]?.positions.buffer);
  });

  it("estado de conexión: abierto, caída y reconexión con espera", () => {
    const { sockets, of, timers } = setup();
    (sockets[0] as FakeSocket).open();
    (sockets[0] as FakeSocket).drop();
    expect(of("status").map((s) => s.state)).toEqual(["connecting", "open", "reconnecting"]);
    expect(timers.run()).toBe(1000);
    expect(sockets).toHaveLength(2);
  });

  it("close detiene la conexión", () => {
    const { sockets, handle, of } = setup();
    handle({ type: "close" });
    expect((sockets[0] as FakeSocket).closed).toBe(true);
    expect(of("status").at(-1)?.state).toBe("closed");
  });

  it("reduced-motion aplicado a los datos nuevos", () => {
    const { sockets, handle, of } = setup();
    const s = sockets[0] as FakeSocket;
    handle({ type: "reducedMotion", value: true });
    s.receive(JSON.stringify(snapshot({ bus: [bus("a", { lon: -8.4 })] })));
    handle({ type: "tick", now: T0 });
    s.receive(JSON.stringify(delta("bus", [bus("a", { lon: -8.39, ts: T0 + 9000 })])));
    handle({ type: "tick", now: T0 + 1 });
    expect(of("frames").at(-1)?.frames[0]?.positions[0]).toBeCloseTo(-8.39, 4);
  });

  it("`online` fuerza la reconexión inmediata (sin esperar el backoff)", () => {
    const { sockets, handle, timers, of } = setup();
    const first = sockets[0] as FakeSocket;
    first.open();
    first.drop();
    expect(sockets).toHaveLength(1);
    handle({ type: "online" });
    expect(sockets).toHaveLength(2);
    expect(timers.pending).toBeLessThanOrEqual(1); // solo el watchdog del nuevo socket
    expect(of("status").at(-1)?.state).toBe("connecting");
  });

  it("un socket semiabierto en silencio se cierra y se reconecta (watchdog de 120 s)", () => {
    const { sockets, timers } = setup();
    const first = sockets[0] as FakeSocket;
    first.open();
    first.receive(JSON.stringify(snapshot({ bus: [bus("a")] })));
    expect(timers.run()).toBe(120_000);
    expect(first.closed).toBe(true);
    expect(timers.run()).toBe(1000);
    expect(sockets).toHaveLength(2);
  });
});
