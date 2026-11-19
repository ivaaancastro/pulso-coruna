import { describe, expect, it } from "vitest";
import { LiveEngine } from "./engine";
import { T0, bus, delta, snapshot, station, wind } from "./test-helpers";

describe("LiveEngine", () => {
  it("snapshot: reemplaza capas, emite items y construye fotograma de móviles", () => {
    const e = new LiveEngine();
    const events = e.handle(
      snapshot({ bus: [bus("a"), bus("b")], bike: [station("s1")], weather: [wind("w1")] }),
      T0,
    );
    const byLayer = Object.fromEntries(events.map((ev) => [ev.layer, ev]));
    expect(byLayer.bus?.replace).toBe(true);
    expect(byLayer.bus?.upserts).toHaveLength(2);
    expect(byLayer.bike?.upserts).toHaveLength(1);
    const frames = e.frames(T0);
    expect(frames.map((f) => f.layer)).toEqual(["bus"]); // solo los móviles se interpolan
    expect(frames[0]).toMatchObject({ count: 2, ids: ["a", "b"] });
  });

  it("delta: upsert/remove y la identidad de observaciones", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a")], weather: [wind("w1")] }), T0);
    const [d] = e.handle(delta("bus", [bus("b", { ts: T0 + 1 })], ["a"], T0 + 1), T0 + 1);
    expect(d).toMatchObject({ replace: false, removes: ["a"], dataTs: T0 + 1 });
    expect([...e.store.get("bus").keys()]).toEqual(["b"]);
    e.handle(delta("weather", [], ["w1:wind_speed"]), T0 + 2);
    expect(e.store.get("weather").size).toBe(0);
  });

  it("snapshot posterior (reconexión): conserva continuidad y retira lo que falta", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a", { lon: -8.4 }), bus("b")] }), T0);
    e.frames(T0);
    e.handle(snapshot({ bus: [bus("a", { lon: -8.39, ts: T0 + 5000 })] }, T0 + 5000), T0 + 1000);
    const [f] = e.frames(T0 + 1000);
    expect(f?.count).toBe(1);
    expect(f?.ids).toEqual(["a"]);
    expect(f?.positions[0]).toBeCloseTo(-8.4, 4); // aún en la pose anterior: sin salto
    const [g] = e.frames(T0 + 6000);
    expect(g?.positions[0]).toBeCloseTo(-8.39, 4);
  });

  it("capa ausente del snapshot: queda vacía y conserva su frescura", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a")], bike: [station("s")] }), T0);
    const events = e.handle(snapshot({ bus: [bus("a", { ts: T0 + 1 })] }, T0 + 1), T0 + 10);
    const bike = events.find((ev) => ev.layer === "bike");
    expect(bike).toMatchObject({ replace: true, upserts: [], receivedAt: T0 });
    expect(e.store.get("bike").size).toBe(0);
  });

  it("dato viejo: no cambia ni el almacén ni la interpolación", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a", { lon: -8.4, ts: T0 + 10 })] }), T0);
    const [ev] = e.handle(delta("bus", [bus("a", { lon: -9, ts: T0 })]), T0 + 1);
    expect(ev?.upserts).toEqual([]);
    expect(e.frames(T0 + 100).at(0)?.positions[0]).toBeCloseTo(-8.4, 4);
  });

  it("ids solo viajan cuando cambia la pertenencia; sin cambios ni tramos no hay fotograma", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a")] }), T0);
    expect(e.frames(T0)[0]?.ids).toEqual(["a"]);
    expect(e.frames(T0 + 10)).toEqual([]); // en reposo
    e.handle(delta("bus", [bus("a", { lon: -8.39, ts: T0 + 4000 })], [], T0 + 4000), T0 + 4000);
    const during = e.frames(T0 + 5000)[0];
    expect(during?.ids).toBeNull();
    e.handle(delta("bus", [bus("b")]), T0 + 5000);
    expect(e.frames(T0 + 5001)[0]?.ids).toEqual(["a", "b"]);
  });

  it("entidad que desaparece produce un fotograma vacío para borrarla", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a")] }), T0);
    e.frames(T0);
    e.handle(delta("bus", [], ["a"]), T0 + 1);
    expect(e.frames(T0 + 1)[0]).toMatchObject({ count: 0 });
  });

  it("reduced-motion: solo hay fotograma al cambiar los datos y sin movimiento intermedio", () => {
    const e = new LiveEngine();
    e.setReducedMotion(true);
    e.handle(snapshot({ bus: [bus("a", { lon: -8.4 })] }), T0);
    e.frames(T0);
    e.handle(delta("bus", [bus("a", { lon: -8.39, ts: T0 + 5000 })]), T0 + 10);
    const [f] = e.frames(T0 + 11);
    expect(f?.positions[0]).toBeCloseTo(-8.39, 4);
    expect(e.frames(T0 + 12)).toEqual([]);
  });

  it("un snapshot atrasado no mueve el bus hacia atrás ni lo emite como nuevo", () => {
    const e = new LiveEngine();
    e.handle(snapshot({ bus: [bus("a", { lon: -8.39, ts: T0 + 5000 })] }, T0 + 5000), T0 + 5000);
    const [ev] = e.handle(snapshot({ bus: [bus("a", { lon: -8.4, ts: T0 })] }, T0), T0 + 6000);
    expect(ev?.upserts[0]).toMatchObject({ lon: -8.39, ts: T0 + 5000 });
    expect(ev?.dataTs).toBe(T0 + 5000);
    expect(e.store.get("bus").get("a")).toMatchObject({ lon: -8.39 });
  });

  it("los barcos admiten huecos de minutos sin saltar (interpolación por capa)", () => {
    const e = new LiveEngine();
    const ship = (lon: number, ts: number) => ({
      id: "s1",
      layer: "ship" as const,
      lon,
      lat: 43.37,
      ts,
    });
    e.handle(snapshot({ ship: [ship(-8.4, T0)] }), T0);
    e.handle(delta("ship", [ship(-8.39, T0 + 120_000)]), T0 + 120_000);
    // A mitad del tramo (60 s después de recibirlo) está entre las dos posiciones, no ya en la última.
    const mid = e.frames(T0 + 180_000).find((f) => f.layer === "ship");
    expect(mid?.positions[0]).toBeGreaterThan(-8.4);
    expect(mid?.positions[0]).toBeLessThan(-8.39);
  });
});
