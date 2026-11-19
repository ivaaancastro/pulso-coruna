import { describe, expect, it, vi } from "vitest";
import { LiveStore } from "../live-store";
import { station } from "../test-helpers";
import type { LiveLayerContext } from "../layer-registry";
import bike from "./bike.layer";

function ctx(reducedMotion: boolean): LiveLayerContext {
  const store = new LiveStore();
  store.apply({
    type: "items",
    layer: "bike",
    replace: true,
    upserts: [station("a", { bikes: 4, docks: 6 }), station("b", { bikes: 0, docks: 0 })],
    removes: [],
    receivedAt: 1,
    dataTs: 1,
  });
  return { store, now: 1, reducedMotion, invalidate: vi.fn() };
}

describe("bike.layer (contrato del registro)", () => {
  it("se suscribe a la capa bike y no es animada", () => {
    expect(bike.id).toBe("bike");
    expect(bike.sources).toEqual(["bike"]);
    expect(bike.animated).toBeFalsy();
  });

  it("crea aro, relleno, selección y zona de toque con una instancia por estación", () => {
    const layers = bike.createLayers(ctx(false));
    expect(layers.map((l) => l.id)).toEqual([
      "bike-ring",
      "bike-fill",
      "bike-selected",
      "bike-hit",
    ]);
    const [ring, fill, selected, hit] = layers as unknown as { props: Record<string, unknown> }[];
    expect((ring?.props["data"] as unknown[]).length).toBe(2);
    expect((fill?.props["data"] as unknown[]).length).toBe(2);
    expect((selected?.props["data"] as unknown[]).length).toBe(0);
    expect(hit?.props["pickable"]).toBe(true);
  });

  it("transiciones solo sin reduced-motion", () => {
    const [ringMotion, fillMotion] = bike.createLayers(ctx(false)) as unknown as {
      props: Record<string, unknown>;
    }[];
    expect(ringMotion?.props["transitions"]).toBeTruthy();
    expect(fillMotion?.props["transitions"]).toBeTruthy();
    const [ringStill, fillStill] = bike.createLayers(ctx(true)) as unknown as {
      props: Record<string, unknown>;
    }[];
    expect(ringStill?.props["transitions"]).toBeFalsy();
    expect(fillStill?.props["transitions"]).toBeFalsy();
  });
});
