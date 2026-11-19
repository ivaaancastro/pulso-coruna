import { REPLAY_WINDOW_MS } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { WINDOW_MS, WindowCache, windowStart } from "./windows";

describe("ventanas alineadas", () => {
  it("coincide con el contrato de la API", () => {
    expect(WINDOW_MS).toBe(REPLAY_WINDOW_MS);
  });

  it("windowStart alinea a múltiplos de 5 min", () => {
    expect(windowStart(0)).toBe(0);
    expect(windowStart(299_999)).toBe(0);
    expect(windowStart(300_000)).toBe(300_000);
    const t = 1_760_000_123_456;
    expect(windowStart(t) % WINDOW_MS).toBe(0);
    expect(t - windowStart(t)).toBeLessThan(WINDOW_MS);
  });
});

describe("WindowCache (LRU)", () => {
  it("expulsa lo menos usado al pasar el máximo de entradas", () => {
    const c = new WindowCache<string>(3, 1e9);
    c.set(1, "a", 1);
    c.set(2, "b", 1);
    c.set(3, "c", 1);
    c.get(1); // 1 pasa a ser la más reciente
    c.set(4, "d", 1);
    expect(c.has(2)).toBe(false); // la menos usada
    expect(c.has(1) && c.has(3) && c.has(4)).toBe(true);
    expect(c.size).toBe(3);
  });

  it("también acota por bytes y nunca expulsa la entrada recién guardada", () => {
    const c = new WindowCache<string>(100, 10);
    c.set(1, "a", 6);
    c.set(2, "b", 6);
    expect(c.has(1)).toBe(false);
    expect(c.has(2)).toBe(true);
    c.set(3, "enorme", 50); // más grande que todo el presupuesto: se queda sola
    expect(c.size).toBe(1);
    expect(c.has(3)).toBe(true);
    expect(c.bytes).toBe(50);
  });

  it("peek no cambia el orden; reemplazar una clave recalcula los bytes", () => {
    const c = new WindowCache<string>(2, 1e9);
    c.set(1, "a", 5);
    c.set(2, "b", 5);
    c.peek(1);
    c.set(3, "c", 5); // expulsa 1 (peek no la refrescó)
    expect(c.has(1)).toBe(false);
    c.set(2, "b2", 8);
    expect(c.bytes).toBe(13);
    expect(c.peek(2)).toBe("b2");
  });

  it("retain y clear", () => {
    const c = new WindowCache<number>();
    for (let i = 0; i < 5; i++) c.set(i, i, 10);
    c.retain((k) => k >= 3);
    expect([...Array(5).keys()].filter((k) => c.has(k))).toEqual([3, 4]);
    expect(c.bytes).toBe(20);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });
});
