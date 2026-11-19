import { describe, expect, it, vi } from "vitest";
import { EntitySchema } from "@pulso/schema";
import {
  BOUNDING_BOX,
  KNOT_MS,
  STREAM_URL,
  aisstreamConfigFromEnv,
  createAisstreamAdapter,
  parseAisMessage,
  parseAisstream,
  parseTimeUtc,
  reconnectDelay,
  shipId,
  type WebSocketLike,
} from "./index.js";

// Fixtures SINTÉTICAS según la documentación (no capturadas con tráfico real).
import fixtures from "./fixtures/mensajes.json";

const fx = (k: string): unknown => structuredClone((fixtures as Record<string, unknown>)[k]);
const T0 = Date.parse("2026-11-18T10:16:00Z");
const SALT = "sal-de-test";

class FakeSocket implements WebSocketLike {
  binaryType = "blob";
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({});
  }
  open(): void {
    this.onopen?.({});
  }
  emit(obj: unknown, binary = false): void {
    const text = JSON.stringify(obj);
    this.onmessage?.({ data: binary ? new TextEncoder().encode(text).buffer : text });
  }
}

/** Entorno controlado: reloj y temporizadores a mano, sockets simulados. */
function harness(extra: Partial<Parameters<typeof createAisstreamAdapter>[0]> = {}) {
  let t = T0;
  const sockets: FakeSocket[] = [];
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const adapter = createAisstreamAdapter({
    apiKey: "CLAVE-DE-TEST",
    idSalt: SALT,
    now: () => t,
    random: () => 1, // jitter máximo: espera = tope
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...extra,
  });
  const advance = (ms: number): void => {
    const target = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      t = Math.max(t, next.at);
      next.fn();
    }
    t = target;
  };
  return { adapter, sockets, advance, timers, now: () => t };
}

const sk = (h: { sockets: FakeSocket[] }, i: number): FakeSocket => {
  const s = h.sockets[i];
  if (!s) throw new Error(`no hay socket ${i}`);
  return s;
};

const cycle = async (a: ReturnType<typeof harness>["adapter"]) =>
  a.parse(await a.fetch(new AbortController().signal));

describe("parse", () => {
  it("PositionReport: mapea posición, rumbo, velocidad (nudos→m/s) y meta sin MMSI", () => {
    const u = parseAisMessage(fx("positionReport"), T0);
    expect(u).toMatchObject({ mmsi: "224123456", name: "EJEMPLO UNO" });
    expect(u?.ts).toBe(Date.parse("2026-11-18T10:15:30.123Z"));
    const out = parseAisstream({
      receivedAt: T0,
      salt: SALT,
      ships: [{ mmsi: "224123456", ...u?.position, ts: u?.ts, name: u?.name }],
    });
    expect(out).toHaveLength(1);
    const e = out[0];
    if (!e) throw new Error("sin entidad");
    expect(EntitySchema.safeParse(e).success).toBe(true);
    expect(e).toMatchObject({ layer: "ship", lat: 43.3702, lon: -8.3905, heading: 87 });
    expect(e.speed).toBeCloseTo(12.4 * KNOT_MS, 1);
    expect(e.id).toBe(shipId("224123456", SALT));
    expect(e.meta).toEqual({ name: "EJEMPLO UNO", navStatus: 0 });
    expect(JSON.stringify(e)).not.toContain("224123456");
  });

  it("Sog 102.3, TrueHeading 511 y Cog 360 = no disponible", () => {
    const u = parseAisMessage(fx("positionNoDisponible"), T0);
    expect(u?.position).toEqual({ lat: 43.3601, lon: -8.4102, navStatus: 5 });
    const [e] = parseAisstream({
      salt: SALT,
      ships: [{ mmsi: "224765432", ...u?.position, ts: u?.ts }],
    });
    expect(e).not.toHaveProperty("speed");
    expect(e).not.toHaveProperty("heading");
  });

  it("sin TrueHeading usa Cog solo si el barco se mueve", () => {
    const u = parseAisMessage(fx("sinRumboConCog"), T0);
    if (!u) throw new Error("sin update");
    const moving = parseAisstream({
      salt: SALT,
      ships: [{ mmsi: "224555000", ...u.position, ts: u.ts }],
    });
    expect(moving[0]?.heading).toBe(211.4);
    const stopped = parseAisstream({
      salt: SALT,
      ships: [{ mmsi: "224555000", ...u.position, sogKn: 0.1, ts: u.ts }],
    });
    expect(stopped[0]).not.toHaveProperty("heading");
  });

  it("Class B, Class B extendido (con tipo) y ShipStaticData", () => {
    expect(parseAisMessage(fx("classB"), T0)?.position).toMatchObject({ sogKn: 4.2, heading: 44 });
    expect(parseAisMessage(fx("extendedClassB"), T0)).toMatchObject({
      shipType: 30,
      name: "PESQUERO CINCO",
    });
    const st = parseAisMessage(fx("shipStaticData"), T0);
    expect(st).toMatchObject({ mmsi: "224123456", shipType: 70, name: "EJEMPLO UNO" });
    expect(st?.position).toBeUndefined();
  });

  it("descarta fuera de zona, posición no disponible, tipos no suscritos y basura", () => {
    expect(parseAisMessage(fx("fueraDeZona"), T0)).toBeNull();
    expect(parseAisMessage(fx("posicionNoDisponible"), T0)).toBeNull();
    expect(parseAisMessage({ MessageType: "BaseStationReport", Message: {} }, T0)).toBeNull();
    expect(parseAisMessage({ MessageType: "PositionReport" }, T0)).toBeNull();
    expect(parseAisMessage(null, T0)).toBeNull();
    expect(parseAisMessage("x", T0)).toBeNull();
    const m = fx("positionReport") as { Message: { PositionReport: { UserID: number } } };
    m.Message.PositionReport.UserID = 12;
    expect(parseAisMessage(m, T0)).toBeNull();
    expect(parseAisstream(null)).toEqual([]);
    expect(parseAisstream({ ships: [{}], salt: SALT })).toEqual([]);
    expect(parseAisstream({ ships: [], salt: "" })).toEqual([]);
  });

  it("time_utc: parsea; si falta o es futuro usa la recepción", () => {
    expect(parseTimeUtc("2026-11-18 10:15:30.5 +0000 UTC")).toBe(
      Date.parse("2026-11-18T10:15:30.500Z"),
    );
    expect(parseTimeUtc("basura")).toBeUndefined();
    expect(parseTimeUtc(undefined)).toBeUndefined();
    const m = fx("positionReport") as { MetaData: Record<string, unknown> };
    delete m.MetaData.time_utc;
    expect(parseAisMessage(m, T0)?.ts).toBe(T0);
    m.MetaData.time_utc = "2030-01-01 00:00:00 +0000 UTC";
    expect(parseAisMessage(m, T0)?.ts).toBe(T0);
  });

  it("el id es estable, depende de la sal y no contiene el MMSI", () => {
    expect(shipId("224123456", "a")).toBe(shipId("224123456", "a"));
    expect(shipId("224123456", "a")).not.toBe(shipId("224123456", "b"));
    expect(shipId("224123456", "a")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("configuración", () => {
  it("sin clave o sin sal queda desactivado con motivo", () => {
    expect(aisstreamConfigFromEnv({})).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("AISSTREAM_API_KEY"),
    });
    expect(aisstreamConfigFromEnv({ AISSTREAM_API_KEY: "k" })).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("SHIP_ID_SALT"),
    });
    expect(aisstreamConfigFromEnv({ AISSTREAM_API_KEY: " ", SHIP_ID_SALT: "s" }).enabled).toBe(
      false,
    );
    expect(aisstreamConfigFromEnv({ AISSTREAM_API_KEY: "k", SHIP_ID_SALT: "s" })).toEqual({
      enabled: true,
      apiKey: "k",
      idSalt: "s",
    });
  });

  it("crear sin sal o sin clave lanza", () => {
    expect(() => createAisstreamAdapter({ apiKey: "k", idSalt: "" })).toThrow();
    expect(() => createAisstreamAdapter({ apiKey: "", idSalt: "s" })).toThrow();
  });
});

describe("colector", () => {
  it("no abre ningún socket hasta el primer fetch; suscribe con clave, bbox y filtros", async () => {
    const h = harness();
    expect(h.sockets).toHaveLength(0);
    await cycle(h.adapter);
    expect(h.sockets).toHaveLength(1);
    const s = sk(h, 0);
    expect(s.url).toBe(STREAM_URL);
    expect(s.binaryType).toBe("arraybuffer");
    s.open();
    expect(s.sent).toHaveLength(1);
    expect(JSON.parse(s.sent[0] ?? "null")).toEqual({
      APIKey: "CLAVE-DE-TEST",
      BoundingBoxes: [BOUNDING_BOX.map((c) => [...c])],
      FilterMessageTypes: [
        "PositionReport",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport",
        "ShipStaticData",
      ],
    });
  });

  it("acumula mensajes (texto y binario), fusiona estáticos y vuelca solo lo nuevo", async () => {
    const h = harness();
    await cycle(h.adapter);
    const s = sk(h, 0);
    s.open();
    s.emit({ SubscriptionConfirmation: { Message: "Subscription applied" } });
    s.emit(fx("positionReport"));
    s.emit(fx("classB"), true);
    s.emit(fx("shipStaticData"));
    s.emit(fx("fueraDeZona"));
    const first = await cycle(h.adapter);
    expect(first).toHaveLength(2);
    const uno = first.find((e) => e.id === shipId("224123456", SALT));
    expect(uno?.meta).toEqual({ name: "EJEMPLO UNO", navStatus: 0, shipType: 70 });
    expect(await cycle(h.adapter)).toEqual([]); // nada nuevo: no se repite
    s.emit(fx("classB")); // mismo ts: no es nuevo
    expect(await cycle(h.adapter)).toEqual([]);
    const m = fx("classB") as { MetaData: Record<string, unknown> };
    m.MetaData.time_utc = "2026-11-18 10:15:50.000000000 +0000 UTC";
    s.emit(m);
    expect(await cycle(h.adapter)).toHaveLength(1);
  });

  it("ignora posiciones más antiguas que la ya guardada y JSON roto", async () => {
    const h = harness();
    await cycle(h.adapter);
    const s = sk(h, 0);
    s.open();
    s.emit(fx("classB"));
    await cycle(h.adapter);
    const old = fx("classB") as { MetaData: Record<string, unknown> };
    old.MetaData.time_utc = "2026-11-18 10:00:00 +0000 UTC";
    s.emit(old);
    s.onmessage?.({ data: "{no json" });
    expect(await cycle(h.adapter)).toEqual([]);
  });

  it("purga barcos sin mensajes en purgeMs", async () => {
    const h = harness({ purgeMs: 5 * 60_000 });
    await cycle(h.adapter);
    const s = sk(h, 0);
    s.open();
    s.emit(fx("positionReport"));
    s.emit(fx("classB"));
    await cycle(h.adapter);
    expect(h.adapter.collector.size).toBe(2);
    h.advance(3 * 60_000);
    s.emit(fx("classB"));
    await cycle(h.adapter);
    h.advance(3 * 60_000); // positionReport lleva 6 min callado, classB 3
    await cycle(h.adapter);
    expect(h.adapter.collector.size).toBe(1);
  });

  it("reconecta con backoff exponencial tras cerrarse y reinicia el backoff con datos", async () => {
    const h = harness();
    await cycle(h.adapter);
    sk(h, 0).open();
    sk(h, 0).close(); // 1.º fallo: espera 1 s
    expect(h.sockets).toHaveLength(1);
    h.advance(999);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets).toHaveLength(2);
    sk(h, 1).close(); // sin abrir: 2.º fallo, 2 s
    h.advance(1_999);
    expect(h.sockets).toHaveLength(2);
    h.advance(1);
    expect(h.sockets).toHaveLength(3);
    sk(h, 2).open();
    sk(h, 2).emit(fx("classB")); // datos: backoff a cero
    sk(h, 2).close();
    h.advance(1_000);
    expect(h.sockets).toHaveLength(4);
    expect(sk(h, 3).sent).toHaveLength(0);
    sk(h, 3).open();
    expect(sk(h, 3).sent).toHaveLength(1); // re-suscribe en cada conexión nueva
  });

  it("el backoff crece con tope y lleva jitter", () => {
    expect(reconnectDelay(1, () => 1)).toBe(1_000);
    expect(reconnectDelay(1, () => 0)).toBe(500);
    expect(reconnectDelay(4, () => 1)).toBe(8_000);
    expect(reconnectDelay(30, () => 1)).toBe(60_000);
  });

  it("un error del servidor (clave inválida) no reinicia el backoff", async () => {
    const warn = vi.fn();
    const h = harness({ logger: { info() {}, warn } });
    await cycle(h.adapter);
    sk(h, 0).open();
    sk(h, 0).emit({ error: "Api Key Is Not Valid" });
    sk(h, 0).close();
    h.advance(1_000);
    sk(h, 1).close();
    h.advance(1_999);
    expect(h.sockets).toHaveLength(2);
    h.advance(1);
    expect(h.sockets).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith("aisstream: error del servidor", {
      error: "Api Key Is Not Valid",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("CLAVE-DE-TEST");
  });

  it("si el constructor del socket lanza, reintenta sin romper", async () => {
    let calls = 0;
    const h = harness({
      createSocket: () => {
        calls++;
        throw new Error("sin red");
      },
    });
    await cycle(h.adapter);
    expect(calls).toBe(1);
    h.advance(1_000);
    expect(calls).toBe(2);
  });

  it("watchdog: con la conexión abierta pero muda se reconecta", async () => {
    const h = harness({ silenceMs: 60_000 });
    await cycle(h.adapter);
    const s = sk(h, 0);
    s.open();
    h.advance(59_000);
    s.emit(fx("classB")); // actividad: reinicia el watchdog
    h.advance(59_000);
    expect(s.closed).toBe(false);
    h.advance(1_001);
    expect(s.closed).toBe(true);
    h.advance(1_000);
    expect(h.sockets).toHaveLength(2);
  });

  it("fetch falla si lleva más de downMs sin conexión y se recupera al conectar", async () => {
    const h = harness({ downMs: 120_000 });
    await cycle(h.adapter); // recién arrancado: aún no es fallo
    h.advance(121_000);
    await expect(h.adapter.fetch(new AbortController().signal)).rejects.toThrow(/sin conexión/);
    const last = sk(h, h.sockets.length - 1);
    last.open();
    last.emit({ SubscriptionConfirmation: { Message: "Subscription applied" } });
    await expect(cycle(h.adapter)).resolves.toEqual([]);
  });

  it("close() cierra el socket y cancela reconexiones", async () => {
    const h = harness();
    await cycle(h.adapter);
    const s = sk(h, 0);
    s.open();
    h.adapter.close();
    expect(s.closed).toBe(true);
    h.advance(10 * 60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.timers).toHaveLength(0);
  });

  it("clave inválida (abre, error, cierra, en bucle) acaba en fallo de fetch", async () => {
    const h = harness({ downMs: 120_000 });
    await cycle(h.adapter);
    for (let i = 0; i < 6; i++) {
      const s = sk(h, h.sockets.length - 1);
      s.open();
      s.emit({ error: "Api Key Is Not Valid" });
      s.close();
      h.advance(60_000);
    }
    await expect(h.adapter.fetch(new AbortController().signal)).rejects.toThrow(/sin conexión/);
  });
});
