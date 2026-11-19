import type { Entity } from "@pulso/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStore } from "../live-store";
import { LayerPipeline } from "../layer-pipeline";
import { T0 } from "../test-helpers";
import shipLayer from "./ship.layer";
import { shipTrailConfig } from "./ship/trail";

const ship = (id: string, over: Partial<Entity> = {}): Entity => ({
  id,
  layer: "ship",
  lon: -8.39,
  lat: 43.37,
  ts: T0,
  speed: 4,
  heading: 90,
  meta: { name: "MOCK", shipType: 70 },
  ...over,
});

function storeWith(entities: Entity[], positions: number[]): LiveStore {
  const store = new LiveStore();
  store.apply({
    type: "items",
    layer: "ship",
    replace: true,
    upserts: entities,
    removes: [],
    receivedAt: T0,
    dataTs: T0,
  });
  store.apply({
    type: "frames",
    frames: [
      {
        layer: "ship",
        count: entities.length,
        idsVersion: 1,
        ids: entities.map((e) => e.id),
        positions: new Float32Array(positions),
        headings: new Float32Array(entities.map((e) => e.heading ?? 0)),
      },
    ],
  });
  return store;
}

const pipeline = (store: LiveStore, reducedMotion = false, now = T0) =>
  new LayerPipeline({
    definitions: [shipLayer],
    store,
    now: () => now,
    reducedMotion: () => reducedMotion,
  });

afterEach(() => {
  shipTrailConfig.setQuality("high");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("capa ship (definición)", () => {
  it("cumple el contrato del registro", () => {
    expect(shipLayer.id).toBe("ship");
    expect(shipLayer.sources).toEqual(["ship"]);
    expect(shipLayer.animated).toBe(true);
    expect(typeof shipLayer.setQualityLevel).toBe("function");
    expect(typeof shipLayer.onSourceState).toBe("function");
  });

  it("sin barcos no dibuja nada ni escribe en consola", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(pipeline(new LiveStore()).collect()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("con datos crea estela, iconos y zona de toque, con ids estables", () => {
    const store = storeWith([ship("a"), ship("b")], [-8.39, 43.37, -8.38, 43.371]);
    const p = pipeline(store);
    const first = p.collect().map((l) => l.id);
    p.notify({ kind: "frames", layers: ["ship"] });
    expect(p.collect().map((l) => l.id)).toEqual(first);
    expect(first).toEqual(["ship-trails", "ship-icons", "ship-hit"]);
  });

  it("solo la zona de toque es picable, con un disco de 44 px por barco", () => {
    const store = storeWith([ship("a")], [-8.39, 43.37]);
    const layers = pipeline(store).collect();
    const picks = layers.filter((l) => (l.props as { pickable?: boolean }).pickable === true);
    expect(picks.map((l) => l.id)).toEqual(["ship-hit"]);
  });

  it("con reduced-motion no hay estelas; en calidad baja tampoco", () => {
    const store = storeWith([ship("a")], [-8.39, 43.37]);
    const len = (layers: ReturnType<LayerPipeline["collect"]>): number =>
      (layers.find((l) => l.id === "ship-trails")?.props.data as { length: number }).length;
    expect(len(pipeline(store, true).collect())).toBe(0);
    shipLayer.setQualityLevel?.("low");
    expect(len(pipeline(store).collect())).toBe(0);
  });

  it("un barco vencido (> 10 min) no se dibuja ni se puede tocar", () => {
    const store = storeWith([ship("old", { ts: T0 - 11 * 60_000 })], [-8.39, 43.37]);
    const layers = pipeline(store).collect();
    const hit = layers.find((l) => l.id === "ship-hit");
    const radii = (hit?.props.data as { attributes: { getRadius: { value: Float32Array } } })
      .attributes.getRadius.value;
    expect([...radii]).toEqual([0]);
  });

  it("tocar un barco abre la tarjeta sin identificadores y `nodata` la cierra", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = storeWith(
      [ship("abc123def456", { meta: { name: "MOCK", shipType: 70 } })],
      [-8.39, 43.37],
    );
    const p = pipeline(store);
    const hit = p.collect().find((l) => l.id === "ship-hit");
    const onClick = hit?.props.onClick as (info: { index: number }) => boolean;
    expect(onClick({ index: 0 })).toBe(true);
    const layers = p.collect(); // la selección invalida la capa
    expect(layers.map((l) => l.id)).toContain("ship-selected");
    const card = document.querySelector<HTMLElement>(".ship-card");
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).toContain("MOCK");
    expect(card?.textContent).toContain("aisstream.io");
    expect(card?.textContent).not.toContain("abc123def456");

    shipLayer.onSourceState?.("nodata");
    expect(document.querySelector<HTMLElement>(".ship-card")?.hidden).toBe(true);
    expect(
      p
        .collect()
        .map((l) => l.id)
        .includes("ship-selected"),
    ).toBe(false);
  });

  it("la tarjeta se cierra sola si el barco lleva más de 10 min callado", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = storeWith([ship("a")], [-8.39, 43.37]);
    let now = T0;
    const p = new LayerPipeline({
      definitions: [shipLayer],
      store,
      now: () => now,
      reducedMotion: () => false,
    });
    const hit = p.collect().find((l) => l.id === "ship-hit");
    (hit?.props.onClick as (info: { index: number }) => boolean)({ index: 0 });
    p.collect();
    expect(document.querySelector<HTMLElement>(".ship-card")?.hidden).toBe(false);
    now = T0 + 11 * 60_000;
    p.collect();
    expect(document.querySelector<HTMLElement>(".ship-card")?.hidden).toBe(true);
  });

  it("Esc cierra la tarjeta y tocar de nuevo el barco seleccionado la cierra", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = storeWith([ship("a")], [-8.39, 43.37]);
    const p = pipeline(store);
    const click = (): void => {
      const hit = p.collect().find((l) => l.id === "ship-hit");
      (hit?.props.onClick as (info: { index: number }) => boolean)({ index: 0 });
      p.collect();
    };
    const hidden = (): boolean | undefined =>
      document.querySelector<HTMLElement>(".ship-card")?.hidden;
    click();
    expect(hidden()).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(hidden()).toBe(true);
    click();
    expect(hidden()).toBe(false);
    click(); // mismo barco: deselecciona
    expect(hidden()).toBe(true);
  });
});
