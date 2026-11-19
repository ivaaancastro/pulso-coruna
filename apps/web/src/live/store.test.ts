import { describe, expect, it } from "vitest";
import { LayerStore, itemKey } from "./store";
import { T0, bus, station, wind } from "./test-helpers";

describe("LayerStore", () => {
  it("clave de identidad: id u observationKey", () => {
    expect(itemKey(bus("b1"))).toBe("b1");
    expect(itemKey(station("s1"))).toBe("s1");
    expect(itemKey(wind("w1"))).toBe("w1:wind_speed");
  });

  it("replace sustituye la capa y fija la frescura", () => {
    const s = new LayerStore();
    s.replace("bus", [bus("a"), bus("b", { ts: T0 + 5 })], T0 + 100);
    s.replace("bus", [bus("c")], T0 + 200);
    expect([...s.get("bus").keys()]).toEqual(["c"]);
    expect(s.freshness("bus")).toEqual({ receivedAt: T0 + 200, dataTs: T0 + 5 });
  });

  it("apply: upserts, removes e ignora datos más viejos que el guardado", () => {
    const s = new LayerStore();
    s.replace("bus", [bus("a", { ts: T0 + 10, lon: -8.41 })], T0);
    const r = s.apply(
      "bus",
      [bus("a", { ts: T0 + 5, lon: -8.5 }), bus("b", { ts: T0 + 20 })],
      ["zzz"],
      T0 + 30,
    );
    expect(r.upserts.map((i) => itemKey(i))).toEqual(["b"]);
    expect(r.removes).toEqual([]);
    expect(s.get("bus").get("a")).toMatchObject({ lon: -8.41 });
    const r2 = s.apply("bus", [], ["a"], T0 + 40);
    expect(r2.removes).toEqual(["a"]);
    expect([...s.get("bus").keys()]).toEqual(["b"]);
  });

  it("observaciones y bicis por su clave", () => {
    const s = new LayerStore();
    s.apply("weather", [wind("w1"), wind("w1", { metric: "wind_dir", value: 90 })], [], T0);
    s.apply("weather", [], ["w1:wind_dir"], T0 + 1);
    expect([...s.get("weather").keys()]).toEqual(["w1:wind_speed"]);
    s.apply("bike", [station("s1", { bikes: 1 }), station("s1", { bikes: 2, ts: T0 + 1 })], [], T0);
    expect(s.get("bike").get("s1")).toMatchObject({ bikes: 2 });
  });

  it("clear vacía sin tocar la frescura; capa desconocida vacía y sin frescura", () => {
    const s = new LayerStore();
    expect(s.get("air").size).toBe(0);
    expect(s.freshness("air")).toBeUndefined();
    s.replace("bus", [bus("a")], T0);
    s.clear("bus");
    expect(s.get("bus").size).toBe(0);
    expect(s.freshness("bus")?.receivedAt).toBe(T0);
  });
});
