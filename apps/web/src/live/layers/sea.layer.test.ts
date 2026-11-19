import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStore } from "../live-store";
import { T0, tide } from "../test-helpers";
import type { LiveLayerContext } from "../layer-registry";
import { createSeaLayer } from "./sea.layer";
import sea from "./sea.layer";

afterEach(() => document.body.replaceChildren());

function setup(reducedMotion = false) {
  const store = new LiveStore();
  let now = T0 + 60_000;
  const invalidate = vi.fn();
  const layer = createSeaLayer({ now: () => now, locale: "es" });
  const ctx = (): LiveLayerContext => ({ store, now, reducedMotion, invalidate });
  const feed = (value: number, ts: number): void => {
    store.apply({
      type: "items",
      layer: "sea",
      replace: false,
      upserts: [tide(value, ts)],
      removes: [],
      receivedAt: ts,
      dataTs: ts,
    });
  };
  return {
    layer,
    ctx,
    feed,
    invalidate,
    store,
    setNow: (n: number) => {
      now = n;
    },
  };
}

const chip = () => document.querySelector<HTMLButtonElement>(".sea-chip");
type Props = { props: Record<string, unknown> };

describe("sea.layer (contrato del registro)", () => {
  it("se suscribe a la capa sea y no es animada", () => {
    expect(sea.id).toBe("sea");
    expect(sea.sources).toEqual(["sea"]);
    expect(sea.animated).toBeFalsy();
  });

  it("sin datos no dibuja nada ni monta el indicador", () => {
    const { layer, ctx } = setup();
    expect(layer.createLayers(ctx())).toEqual([]);
    expect(chip()).toBeNull();
  });

  it("con un nivel crea halo, línea, mareógrafo y zona de toque", () => {
    const { layer, ctx, feed } = setup();
    feed(3.2, T0);
    const layers = layer.createLayers(ctx());
    expect(layers.map((l) => l.id)).toEqual(["sea-halo", "sea-line", "sea-gauge", "sea-hit"]);
    const [halo, line, , hit] = layers as unknown as Props[];
    expect((halo?.props["data"] as unknown[]).length).toBe(9);
    expect(line?.props["transitions"]).toBeDefined();
    expect(hit?.props["pickable"]).toBe(true);
    expect(chip()?.hidden).toBe(false);
  });

  it("con reduced-motion no hay transiciones", () => {
    const { layer, ctx, feed } = setup(true);
    feed(3.2, T0);
    const [halo, line] = layer.createLayers(ctx()) as unknown as Props[];
    expect(halo?.props["transitions"]).toBeUndefined();
    expect(line?.props["transitions"]).toBeUndefined();
  });

  it("el halo crece con el nivel y la tendencia sale de las lecturas recibidas", () => {
    const { layer, ctx, feed, setNow } = setup();
    const radius = (): number => {
      const [halo] = layer.createLayers(ctx()) as unknown as Props[];
      const data = halo?.props["data"] as { radius: number }[];
      return data[data.length - 1]?.radius ?? 0;
    };
    feed(1.5, T0);
    setNow(T0);
    const low = radius();
    expect(chip()?.textContent).toContain("Marea 1,50 m");
    expect(chip()?.textContent).not.toContain("Sube");
    for (let i = 1; i <= 4; i++) {
      feed(1.5 + 0.5 * i, T0 + i * 5 * 60_000);
      // El almacén solo guarda la última lectura: la historia se acumula en cada recálculo.
      layer.createLayers(ctx());
    }
    setNow(T0 + 20 * 60_000);
    const high = radius();
    expect(high).toBeGreaterThan(low);
    expect(chip()?.textContent).toContain("Sube");
  });

  it("tocar el mareógrafo abre y cierra la tarjeta y pide recalcular", () => {
    const { layer, ctx, feed, invalidate } = setup();
    feed(3.2, T0);
    const hit = layer.createLayers(ctx())[3] as unknown as Props;
    const onClick = hit.props["onClick"] as (i: { object: unknown }) => boolean;
    expect(onClick({ object: {} })).toBe(true);
    expect(document.querySelector<HTMLElement>(".sea-card")?.hidden).toBe(false);
    expect(invalidate).toHaveBeenCalled();
    onClick({ object: {} });
    expect(document.querySelector<HTMLElement>(".sea-card")?.hidden).toBe(true);
    expect(onClick({ object: undefined })).toBe(false);
  });

  it("en nodata oculta indicador y tarjeta; vuelve con la fuente", () => {
    const { layer, ctx, feed } = setup();
    feed(3.2, T0);
    layer.createLayers(ctx());
    chip()?.click();
    layer.onSourceState?.("nodata");
    expect(chip()?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".sea-card")?.hidden).toBe(true);
    layer.onSourceState?.("live");
    expect(chip()?.hidden).toBe(false);
  });

  it("si el almacén se queda sin lectura, vacía la capa y esconde el indicador", () => {
    const { layer, ctx, feed, store } = setup();
    feed(3.2, T0);
    layer.createLayers(ctx());
    store.apply({
      type: "items",
      layer: "sea",
      replace: true,
      upserts: [],
      removes: [],
      receivedAt: 2,
      dataTs: 2,
    });
    expect(layer.createLayers(ctx())).toEqual([]);
    expect(chip()?.hidden).toBe(true);
  });
});
