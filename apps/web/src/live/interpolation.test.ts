import { describe, expect, it } from "vitest";
import { Interpolator, bearingAndDistance, lerpHeading, normalizeHeading } from "./interpolation";
import { T0, bus } from "./test-helpers";

describe("rumbo", () => {
  it("normaliza y toma el arco más corto", () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
    expect(lerpHeading(359, 1, 0.5)).toBeCloseTo(0, 6);
    expect(lerpHeading(1, 359, 0.5)).toBeCloseTo(0, 6);
    expect(lerpHeading(90, 270, 0)).toBe(90);
    expect(lerpHeading(10, 100, 1)).toBeCloseTo(100, 6);
  });

  it("bearingAndDistance: norte y este", () => {
    expect(bearingAndDistance(-8.4, 43.37, -8.4, 43.38).bearing).toBeCloseTo(0, 3);
    expect(bearingAndDistance(-8.4, 43.37, -8.39, 43.37).bearing).toBeCloseTo(90, 3);
    expect(bearingAndDistance(-8.4, 43.37, -8.4, 43.371).meters).toBeCloseTo(111.3, 0);
  });
});

describe("Interpolator", () => {
  it("primer dato: aparece donde está, sin animación", () => {
    const i = new Interpolator();
    expect(i.upsert(bus("a", { lon: -8.41, lat: 43.36, heading: 90 }), T0)).toBe(true);
    expect(i.sample("a", T0)).toEqual({ lon: -8.41, lat: 43.36, heading: 90 });
    expect(i.sample("a", T0 + 5000)).toEqual({ lon: -8.41, lat: 43.36, heading: 90 });
    expect(i.sample("nope", T0)).toBeUndefined();
  });

  it("interpola de forma continua entre dos posiciones en el intervalo de la fuente", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, lat: 43.37, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.39, lat: 43.38, ts: T0 + 10_000 }), T0 + 10_000);
    expect(i.sample("a", T0 + 10_000)).toMatchObject({ lon: -8.4, lat: 43.37 });
    const mid = i.sample("a", T0 + 15_000);
    expect(mid?.lon).toBeCloseTo(-8.395, 9);
    expect(mid?.lat).toBeCloseTo(43.375, 9);
    expect(i.sample("a", T0 + 20_000)).toMatchObject({ lon: -8.39, lat: 43.38 });
  });

  it("no extrapola: tras el tramo se queda en el último dato", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.39, ts: T0 + 5000 }), T0 + 5000);
    expect(i.sample("a", T0 + 1_000_000)?.lon).toBe(-8.39);
  });

  it("continuidad: un dato que llega a mitad de tramo parte de la pose mostrada", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.38, ts: T0 + 10_000 }), T0 + 10_000);
    const shown = i.sample("a", T0 + 15_000)?.lon as number; // mitad: -8.39
    expect(shown).toBeCloseTo(-8.39, 9);
    i.upsert(bus("a", { lon: -8.3, ts: T0 + 20_000 }), T0 + 15_000);
    expect(i.sample("a", T0 + 15_000)?.lon).toBeCloseTo(shown, 9);
  });

  it("rumbo 359 → 1 gira 2°, nunca 358°", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { heading: 359, ts: T0 }), T0);
    i.upsert(bus("a", { heading: 1, ts: T0 + 10_000 }), T0);
    const headings = [0, 0.25, 0.5, 0.75, 1].map((u) => i.sample("a", T0 + u * 10_000)?.heading);
    for (const h of headings) {
      const dist = Math.min(Math.abs((h as number) - 0), 360 - (h as number));
      expect(dist).toBeLessThanOrEqual(1.0000001);
    }
    expect(headings[2]).toBeCloseTo(0, 6);
    expect(headings[4]).toBeCloseTo(1, 6);
  });

  it("dato viejo o repetido se descarta", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, ts: T0 + 100 }), T0);
    expect(i.upsert(bus("a", { lon: -9, ts: T0 }), T0)).toBe(false);
    expect(i.upsert(bus("a", { lon: -9, ts: T0 + 100 }), T0)).toBe(false);
    expect(i.sample("a", T0)?.lon).toBe(-8.4);
  });

  it("entidad que desaparece: sale del fotograma y del recuento", () => {
    const i = new Interpolator();
    i.upsert(bus("a"), T0);
    i.upsert(bus("b"), T0);
    expect(i.fill(T0).count).toBe(2);
    expect(i.remove("a")).toBe(true);
    expect(i.remove("a")).toBe(false);
    const f = i.fill(T0);
    expect(f.ids).toEqual(["b"]);
    expect(f.positions.length).toBe(2);
    i.retainOnly(new Set());
    expect(i.size).toBe(0);
  });

  it("hueco enorme: salto limpio en vez de deslizarse", () => {
    const i = new Interpolator({ maxDurationMs: 30_000 });
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.3, ts: T0 + 600_000 }), T0 + 1);
    expect(i.sample("a", T0 + 1)?.lon).toBe(-8.3);
  });

  it("sin rumbo en el dato: usa el de la marcha, o conserva el anterior si apenas se movió", () => {
    const i = new Interpolator({ minDurationMs: 1 });
    i.upsert(bus("a", { lon: -8.4, lat: 43.37, heading: 45, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.4, lat: 43.37 + 0.0001, ts: T0 + 1000 }), T0);
    expect(i.sample("a", T0 + 1000)?.heading).toBeCloseTo(0, 3); // 11 m al norte
    i.upsert(bus("a", { lon: -8.4, lat: 43.37 + 0.0001, ts: T0 + 2000 }), T0 + 1000);
    expect(i.sample("a", T0 + 2000)?.heading).toBeCloseTo(0, 3);
  });

  it("reduced-motion: cada dato se muestra tal cual, sin tramos", () => {
    const i = new Interpolator({ reducedMotion: true });
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.39, ts: T0 + 10_000 }), T0);
    expect(i.sample("a", T0)?.lon).toBe(-8.39);
    expect(i.needsFrame()).toBe(true); // sucio por el dato
    i.fill(T0 + 1);
    expect(i.needsFrame()).toBe(false);
  });

  it("setReducedMotion congela las entidades en su destino", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.39, ts: T0 + 10_000 }), T0);
    i.setReducedMotion(true);
    expect(i.sample("a", T0 + 100)?.lon).toBe(-8.39);
  });

  it("needsFrame: activo mientras haya tramos vivos, luego en reposo", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, ts: T0 }), T0);
    i.upsert(bus("a", { lon: -8.39, ts: T0 + 4000 }), T0);
    i.fill(T0);
    expect(i.needsFrame()).toBe(true);
    i.fill(T0 + 1000);
    expect(i.needsFrame()).toBe(true);
    i.fill(T0 + 4001); // fotograma final, ya en el destino
    expect(i.needsFrame()).toBe(false);
  });

  it("fill entrega buffers intercalados y ids estables hasta que cambia la pertenencia", () => {
    const i = new Interpolator();
    i.upsert(bus("a", { lon: -8.4, lat: 43.37, heading: 10 }), T0);
    i.upsert(bus("b", { lon: -8.5, lat: 43.38, heading: 20 }), T0);
    const f1 = i.fill(T0);
    expect(Array.from(f1.positions)).toEqual([-8.4, 43.37, -8.5, 43.38].map((n) => Math.fround(n)));
    expect(Array.from(f1.headings)).toEqual([10, 20]);
    const f2 = i.fill(T0);
    expect(f2.ids).toBe(f1.ids);
    expect(f2.idsVersion).toBe(f1.idsVersion);
    i.remove("a");
    expect(i.fill(T0).idsVersion).toBeGreaterThan(f1.idsVersion);
  });
});
