import type { Entity } from "@pulso/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerPipeline } from "../layer-pipeline";
import { LiveStore } from "../live-store";
import { EXTRAPOLATE_MAX_MS } from "../plane/extrapolate";
import { T0 } from "../test-helpers";
import planeLayer, { REDUCED_STEP_MS } from "./plane.layer";

const plane = (id: string, over: Partial<Entity> = {}): Entity => ({
  id,
  layer: "plane",
  lon: -8.4,
  lat: 43.35,
  ts: T0,
  heading: 90,
  speed: 125,
  meta: { callsign: "IBE1234", alt: 3000, onGround: 0 },
  ...over,
});

function storeWith(entities: Entity[]): LiveStore {
  const store = new LiveStore();
  store.apply({
    type: "items",
    layer: "plane",
    replace: true,
    upserts: entities,
    removes: [],
    receivedAt: T0,
    dataTs: T0,
  });
  return store;
}

function setup(store: LiveStore, opts: { reduced?: boolean } = {}) {
  let now = T0;
  const pipeline = new LayerPipeline({
    definitions: [planeLayer],
    store,
    now: () => now,
    reducedMotion: () => opts.reduced ?? false,
  });
  return {
    pipeline,
    at(ms: number) {
      now = ms;
    },
  };
}

const positionOf = (layers: { id: string; props: unknown }[], layerId: string) => {
  const layer = layers.find((l) => l.id === layerId);
  const data = (layer?.props as { data: { position: [number, number] }[] }).data;
  return data[0]?.position as [number, number];
};

/** Simula el toque sobre el primer avión de la capa de toque. */
function tap(hit: { props: unknown } | undefined): boolean {
  const props = hit?.props as unknown as {
    onClick: (info: unknown) => boolean;
    data: unknown[];
  };
  return props.onClick({ object: props.data[0] });
}

afterEach(() => {
  vi.restoreAllMocks();
  // estado de módulo: vaciar la capa para soltar selección e histórico
  setup(new LiveStore()).pipeline.collect();
  planeLayer.onSourceState?.("nodata");
});

describe("capa plane (definición)", () => {
  it("cumple el contrato del registro", () => {
    expect(planeLayer.id).toBe("plane");
    expect(planeLayer.sources).toEqual(["plane"]);
  });

  it("vacía: no dibuja, no escribe en consola y no pide fotogramas", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pipeline } = setup(new LiveStore());
    expect(pipeline.collect()).toEqual([]);
    expect(planeLayer.animated).toBe(false);
    expect(pipeline.pending).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("un avión: traza, icono, zona de toque; pide fotogramas; ids estables", () => {
    const { pipeline } = setup(storeWith([plane("a")]));
    const ids = pipeline.collect().map((l) => l.id);
    expect(ids).toEqual(["plane-trail", "plane-icons", "plane-hit"]);
    expect(planeLayer.animated).toBe(true);
    pipeline.notify({ kind: "connection" });
    expect(pipeline.collect().map((l) => l.id)).toEqual(ids);
  });

  it("extrapola la posición con el reloj de la app", () => {
    const { pipeline, at } = setup(storeWith([plane("a")]));
    const first = positionOf(pipeline.collect(), "plane-icons");
    expect(first[0]).toBeCloseTo(-8.4, 9);
    at(T0 + 120_000); // 125 m/s × 120 s = 15 km al este
    const later = positionOf(pipeline.collect(), "plane-icons");
    expect((later[0] - first[0]) * 111_320 * Math.cos((43.35 * Math.PI) / 180)).toBeCloseTo(
      15000,
      -1,
    );
    expect(later[1]).toBeCloseTo(first[1], 6);
  });

  it("pasado el tope de 8 min el avión desaparece y la capa deja de pedir fotogramas", () => {
    const { pipeline, at } = setup(storeWith([plane("a")]));
    expect(pipeline.collect().length).toBeGreaterThan(0);
    at(T0 + EXTRAPOLATE_MAX_MS + 1000);
    expect(pipeline.collect()).toEqual([]);
    expect(planeLayer.animated).toBe(false);
  });

  it("en tierra: icono tenue y sin traza", () => {
    const { pipeline } = setup(storeWith([plane("g", { speed: 0, meta: { onGround: 1 } })]));
    const layers = pipeline.collect();
    const trail = layers.find((l) => l.id === "plane-trail");
    expect((trail?.props as { data: unknown[] }).data).toHaveLength(0);
    expect(layers.some((l) => l.id === "plane-icons")).toBe(true);
  });

  it("con reduced-motion la posición avanza a saltos de 15 s", () => {
    const { pipeline, at } = setup(storeWith([plane("a")]), { reduced: true });
    const start = Math.ceil((T0 + 20_000) / REDUCED_STEP_MS) * REDUCED_STEP_MS; // inicio de un salto
    at(start + 1000);
    const a = positionOf(pipeline.collect(), "plane-icons");
    at(start + REDUCED_STEP_MS - 1);
    expect(positionOf(pipeline.collect(), "plane-icons")).toEqual(a);
    at(start + REDUCED_STEP_MS);
    expect(positionOf(pipeline.collect(), "plane-icons")).not.toEqual(a);
  });

  it("al tocar un avión se selecciona (aro y tarjeta) y nodata cierra la tarjeta", () => {
    const store = storeWith([plane("a")]);
    const { pipeline } = setup(store);
    const hit = pipeline.collect().find((l) => l.id === "plane-hit");
    expect(tap(hit)).toBe(true);
    const ids = pipeline.collect().map((l) => l.id);
    expect(ids).toContain("plane-selected");
    const card = document.body.querySelector<HTMLElement>(".plane-card");
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).toContain("IBE1234");
    expect(card?.textContent).toContain("OpenSky Network");

    planeLayer.onSourceState?.("nodata");
    expect(card?.hidden).toBe(true);
    expect(pipeline.collect().map((l) => l.id)).not.toContain("plane-selected");
  });

  it("si el avión seleccionado sale del almacén, la tarjeta se cierra", () => {
    const store = storeWith([plane("a")]);
    const { pipeline } = setup(store);
    const hit = pipeline.collect().find((l) => l.id === "plane-hit");
    tap(hit);
    pipeline.collect();
    store.apply({
      type: "items",
      layer: "plane",
      replace: true,
      upserts: [],
      removes: [],
      receivedAt: T0,
      dataTs: T0,
    });
    pipeline.notify({ kind: "items", layer: "plane" });
    expect(pipeline.collect()).toEqual([]);
    expect(document.body.querySelector<HTMLElement>(".plane-card")?.hidden).toBe(true);
  });
});
