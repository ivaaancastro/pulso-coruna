import { describe, expect, it } from "vitest";
import type { ConnectionState } from "./types";
import { FakeSocket, manualTimers } from "./test-helpers";
import { backoffDelay, createWsClient } from "./ws-client";

describe("backoffDelay", () => {
  it("crece exponencialmente con jitter entre la mitad y el techo, y respeta el tope", () => {
    const o = { baseMs: 1000, capMs: 30_000 };
    expect(backoffDelay(0, { ...o, random: () => 0 })).toBe(500);
    expect(backoffDelay(0, { ...o, random: () => 1 })).toBe(1000);
    expect(backoffDelay(3, { ...o, random: () => 1 })).toBe(8000);
    expect(backoffDelay(3, { ...o, random: () => 0 })).toBe(4000);
    expect(backoffDelay(20, { ...o, random: () => 1 })).toBe(30_000);
    expect(backoffDelay(20, { ...o, random: () => 0 })).toBe(15_000);
  });
});

function setup(random = () => 1) {
  const timers = manualTimers();
  const sockets: FakeSocket[] = [];
  const states: [ConnectionState, number][] = [];
  const messages: unknown[] = [];
  const client = createWsClient({
    url: "ws://x/api/v1/stream",
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    onMessage: (d) => messages.push(d),
    onState: (s, a) => states.push([s, a]),
    random,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { client, timers, sockets, states, messages };
}

describe("createWsClient", () => {
  it("conecta, pasa mensajes y notifica el estado", () => {
    const { client, sockets, states, messages } = setup();
    client.connect();
    expect(sockets[0]?.url).toBe("ws://x/api/v1/stream");
    sockets[0]?.open();
    sockets[0]?.receive("hola");
    expect(messages).toEqual(["hola"]);
    expect(states.map((s) => s[0])).toEqual(["connecting", "open"]);
  });

  it("reconecta con espera creciente y tope tras cada caída", () => {
    const { client, timers, sockets, states } = setup();
    client.connect();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      sockets[sockets.length - 1]?.drop();
      delays.push(timers.run());
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(sockets).toHaveLength(9);
    expect(states.at(-1)?.[0]).toBe("reconnecting");
    expect(states.at(-1)?.[1]).toBe(8);
  });

  it("el primer mensaje de una conexión reinicia la espera", () => {
    const { client, timers, sockets } = setup();
    client.connect();
    sockets[0]?.drop();
    timers.run(); // 1000
    sockets[1]?.drop();
    expect(timers.run()).toBe(2000);
    sockets[2]?.open();
    sockets[2]?.receive("snapshot");
    sockets[2]?.drop();
    expect(timers.run()).toBe(1000);
  });

  it("tras reconectar, el primer mensaje avisa de que ya está sana (open, intentos 0)", () => {
    const { client, timers, sockets, states } = setup();
    client.connect();
    sockets[0]?.drop();
    timers.run();
    sockets[1]?.open();
    expect(states.at(-1)).toEqual(["open", 1]); // abierta pero aún sin datos
    sockets[1]?.receive("snapshot");
    expect(states.at(-1)).toEqual(["open", 0]);
    sockets[1]?.receive("delta");
    expect(states.filter((s) => s[0] === "open" && s[1] === 0)).toHaveLength(1);
  });

  it("abrir sin recibir datos no reinicia la espera (servidor que cierra al instante)", () => {
    const { client, timers, sockets } = setup();
    client.connect();
    sockets[0]?.drop();
    timers.run();
    sockets[1]?.open();
    sockets[1]?.drop();
    expect(timers.run()).toBe(2000);
  });

  it("close detiene la reconexión y cierra el socket; ignora eventos tardíos", () => {
    const { client, timers, sockets, states, messages } = setup();
    client.connect();
    sockets[0]?.drop();
    expect(timers.pending).toBe(1);
    client.close();
    expect(timers.pending).toBe(0);
    expect(states.at(-1)?.[0]).toBe("closed");

    const { client: c2, sockets: s2, timers: t2 } = setup();
    c2.connect();
    const first = s2[0] as FakeSocket;
    c2.close();
    expect(first.closed).toBe(true);
    first.drop();
    first.receive("tarde");
    expect(t2.pending).toBe(0);
    expect(messages).toEqual([]);
  });

  it("si crear el socket lanza, reintenta", () => {
    const timers = manualTimers();
    let calls = 0;
    const client = createWsClient({
      url: "ws://x",
      createSocket: () => {
        calls++;
        throw new Error("boom");
      },
      onMessage: () => {},
      onState: () => {},
      random: () => 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    client.connect();
    expect(timers.pending).toBe(1);
    timers.run();
    expect(calls).toBe(2);
  });

  it("connect repetido no abre dos sockets", () => {
    const { client, sockets } = setup();
    client.connect();
    client.connect();
    expect(sockets).toHaveLength(1);
  });
});

describe("createWsClient: watchdog de silencio y retryNow", () => {
  function withWatchdog(silenceMs = 100_000) {
    const timers = manualTimers();
    const sockets: FakeSocket[] = [];
    const states: [ConnectionState, number][] = [];
    const client = createWsClient({
      url: "ws://x/api/v1/stream",
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      onMessage: () => {},
      onState: (s, a) => states.push([s, a]),
      random: () => 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      silenceMs,
    });
    return { client, timers, sockets, states };
  }

  it("sin mensajes durante silenceMs cierra el socket y reconecta con espera", () => {
    const { client, timers, sockets, states } = withWatchdog();
    client.connect();
    sockets[0]?.open();
    expect(timers.pending).toBe(1); // el watchdog
    expect(timers.run()).toBe(100_000);
    expect(sockets[0]?.closed).toBe(true);
    expect(states.at(-1)?.[0]).toBe("reconnecting");
    expect(timers.run()).toBe(1000); // reintento
    expect(sockets).toHaveLength(2);
  });

  it("cada mensaje rearma el watchdog (hay un único temporizador)", () => {
    const { client, timers, sockets } = withWatchdog();
    client.connect();
    sockets[0]?.open();
    for (let i = 0; i < 5; i++) sockets[0]?.receive("x");
    expect(timers.pending).toBe(1);
    expect(sockets[0]?.closed).toBe(false);
  });

  it("un cierre normal retira el watchdog; close() también", () => {
    const { client, timers, sockets } = withWatchdog();
    client.connect();
    sockets[0]?.open();
    sockets[0]?.drop();
    expect(timers.pending).toBe(1); // solo el reintento
    timers.run();
    client.close();
    expect(timers.pending).toBe(0);
  });

  it("retryNow descarta el socket actual aunque parezca abierto y reconecta ya", () => {
    const { client, timers, sockets } = withWatchdog();
    client.connect();
    sockets[0]?.open();
    sockets[0]?.receive("x");
    client.retryNow();
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(timers.pending).toBe(1); // watchdog del nuevo socket
    sockets[0]?.receive("tardío"); // el viejo ya no cuenta
    sockets[0]?.drop();
    expect(sockets).toHaveLength(2);
  });

  it("retryNow salta la espera de un reintento pendiente y no hace nada tras close()", () => {
    const { client, timers, sockets } = withWatchdog();
    client.connect();
    sockets[0]?.drop();
    expect(timers.pending).toBe(1);
    client.retryNow();
    expect(sockets).toHaveLength(2);
    client.close();
    client.retryNow();
    expect(sockets).toHaveLength(2);
  });
});
