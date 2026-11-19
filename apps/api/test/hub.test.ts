import { DeltaMessageSchema, SnapshotMessageSchema, type LayerId } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { StreamHub, type ClientSink } from "../src/hub.js";
import { FakeSource, bus, station, wind } from "./helpers.js";

class Sink implements ClientSink {
  sent: unknown[] = [];
  buffered = 0;
  dropped: string | undefined;
  constructor(public layers: ReadonlySet<LayerId>) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  bufferedAmount(): number {
    return this.buffered;
  }
  drop(reason: string): void {
    this.dropped = reason;
  }
}
const all = new Set<LayerId>(["bus", "bike", "weather", "sea", "ship", "air", "plane", "train"]);
const hub = (src: FakeSource, maxBufferedBytes = 1000): StreamHub =>
  new StreamHub(src, { pollMs: 0, maxBufferedBytes });

describe("StreamHub", () => {
  it("snapshot al conectar (válido) y deltas solo con cambios", async () => {
    const src = new FakeSource();
    src.layers.bike = [station("s1"), station("s2")];
    const h = hub(src);
    const c = new Sink(all);
    await h.attach(c);
    expect(c.sent).toHaveLength(1);
    expect(SnapshotMessageSchema.safeParse(c.sent[0]).success).toBe(true);

    await h.poll(); // sin cambios: nada
    expect(c.sent).toHaveLength(1);

    src.layers.bike = [station("s1", 3), station("s3")];
    await h.poll();
    expect(c.sent).toHaveLength(2);
    const d = DeltaMessageSchema.parse(c.sent[1]);
    expect(d.layer).toBe("bike");
    expect(d.upserts).toHaveLength(2);
    expect(d.removes).toEqual(["s2"]);
  });

  it("deltas de observaciones por observationKey", async () => {
    const src = new FakeSource();
    src.layers.weather = [wind("e1"), wind("e1", 1, { metric: "temp", unit: "C" })];
    const h = hub(src);
    const c = new Sink(all);
    await h.attach(c);
    src.layers.weather = [wind("e1")];
    await h.poll();
    expect(DeltaMessageSchema.parse(c.sent[1]).removes).toEqual(["e1:temp"]);
  });

  it("cada cliente solo recibe sus capas, también en el snapshot", async () => {
    const src = new FakeSource();
    src.layers.bus = [bus("b1")];
    src.layers.bike = [station("s1")];
    const h = hub(src);
    const onlyBike = new Sink(new Set<LayerId>(["bike"]));
    await h.attach(onlyBike);
    expect(Object.keys((onlyBike.sent[0] as { layers: object }).layers)).toEqual(["bike"]);
    src.layers.bus = [bus("b1", -8.5)];
    await h.poll();
    expect(onlyBike.sent).toHaveLength(1);
  });

  it("capas sin datos: listas vacías, sin errores", async () => {
    const h = hub(new FakeSource());
    const c = new Sink(all);
    await h.attach(c);
    const m = SnapshotMessageSchema.parse(c.sent[0]);
    expect(m.layers.bus).toEqual([]);
    expect(Object.keys(m.layers)).toHaveLength(8);
  });

  it("sin clientes no consulta; al volver el estado es fresco", async () => {
    const src = new FakeSource();
    src.layers.bus = [bus("b1")];
    const h = hub(src);
    const a = new Sink(all);
    const detach = await h.attach(a);
    detach();
    expect(h.size).toBe(0);
    const calls = src.latestCalls;
    src.layers.bus = [bus("b2")];
    const b = new Sink(all);
    await h.attach(b);
    expect(src.latestCalls).toBe(calls + 1);
    expect((b.sent[0] as { layers: { bus: { id: string }[] } }).layers.bus[0]?.id).toBe("b2");
  });

  it("BD caída al conectar: attach lanza y no deja el cliente registrado", async () => {
    const src = new FakeSource();
    src.failing = true;
    const h = hub(src);
    await expect(h.attach(new Sink(all))).rejects.toThrow();
    expect(h.size).toBe(0);
  });

  it("un sondeo fallido conserva el estado y el siguiente recupera", async () => {
    const src = new FakeSource();
    src.layers.bus = [bus("b1")];
    const h = hub(src);
    const c = new Sink(all);
    await h.attach(c);
    src.failing = true;
    await expect(h.poll()).rejects.toThrow();
    src.failing = false;
    src.layers.bus = [bus("b1"), bus("b2")];
    await h.poll();
    expect(DeltaMessageSchema.parse(c.sent[1]).upserts).toHaveLength(1);
  });

  it("cliente lento: se desconecta y deja de recibir", async () => {
    const src = new FakeSource();
    src.layers.bus = [bus("b1")];
    const h = hub(src, 100);
    const slow = new Sink(all);
    await h.attach(slow);
    slow.buffered = 1_000_000;
    src.layers.bus = [bus("b1", -8.5)];
    await h.poll();
    expect(slow.dropped).toBeDefined();
    expect(h.size).toBe(0);
  });

  it("un sondeo en vuelo no se aplica a un estado nuevo tras quedarse sin clientes", async () => {
    const src = new FakeSource();
    src.layers.bus = [bus("b1")];
    const h = hub(src);
    const a = new Sink(all);
    const detachA = await h.attach(a);
    // sondeo lento: devuelve datos antiguos cuando ya hay otro estado
    let release: () => void = () => {};
    const realLatest = src.latest.bind(src);
    src.latest = async () => {
      const old = await realLatest();
      await new Promise<void>((r) => (release = r));
      return old;
    };
    const pending = h.poll();
    detachA();
    src.latest = realLatest;
    src.layers.bus = [bus("b1", -8.9)];
    const b = new Sink(all);
    await h.attach(b);
    release();
    await pending;
    expect(b.sent).toHaveLength(1); // ningún delta con datos viejos
  });

  it("con temporizador solo hay una cadena de sondeos aunque entren clientes durante uno", async () => {
    const src = new FakeSource();
    const h = new StreamHub(src, { pollMs: 20, maxBufferedBytes: 1000 });
    await h.attach(new Sink(all));
    await new Promise((r) => setTimeout(r, 30));
    await h.attach(new Sink(all));
    await h.attach(new Sink(all));
    const before = src.latestCalls;
    await new Promise((r) => setTimeout(r, 200));
    // una cadena a 20 ms ≈ 10 sondeos; dos o tres cadenas serían >= 20
    expect(src.latestCalls - before).toBeLessThanOrEqual(12);
    h.stop();
  });
});
