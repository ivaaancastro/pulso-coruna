import { describe, expect, it } from "vitest";
import { LayerPipeline } from "../layer-pipeline";
import type { LiveLayerDefinition } from "../layer-registry";
import { LiveStore } from "../live-store";
import type { SourceState } from "../source-status";
import { T0, bus as busEntity, station } from "../test-helpers";
import bike from "./bike.layer";
import bus from "./bus.layer";

type Clickable = { props: { onClick?: (info: unknown) => boolean; pickable?: boolean } };

function build(def: LiveLayerDefinition, store: LiveStore) {
  const states: Record<string, SourceState> = {};
  const p = new LayerPipeline({
    definitions: [def],
    store,
    now: () => T0,
    reducedMotion: () => true,
    status: (d) => states[d.id] ?? "live",
  });
  return { p, states };
}

describe("tarjeta abierta cuando la capa pasa a «sin datos» (sin datos fantasma)", () => {
  it("bici: la tarjeta se cierra, la selección se limpia y la capa deja de ser seleccionable", () => {
    const store = new LiveStore();
    store.apply({
      type: "items",
      layer: "bike",
      replace: true,
      upserts: [station("7", { bikes: 3, docks: 9 })],
      removes: [],
      receivedAt: T0,
      dataTs: T0,
    });
    const { p, states } = build(bike, store);
    const hit = (): Clickable =>
      p.collect().find((l) => l.id === "bike-hit") as unknown as Clickable;

    hit().props.onClick?.({ object: { id: "7" } });
    const card = document.querySelector<HTMLElement>(".bike-card");
    expect(card?.hidden).toBe(false);

    states["bike"] = "delayed"; // retrasado: la tarjeta se queda (ya dice «Actualizado hace X»)
    p.collect();
    expect(card?.hidden).toBe(false);

    states["bike"] = "nodata";
    const layers = p.collect();
    expect(card?.hidden).toBe(true);
    // la invalidación del hook sobrevive: el siguiente fotograma ya no lleva aro de selección
    const next = p.collect();
    const selected = next.find((l) => l.id === "bike-selected");
    expect((selected?.props as unknown as { data: unknown[] }).data).toHaveLength(0);
    // y ninguna capa es seleccionable mientras no haya dato
    for (const set of [layers, next]) {
      expect(set.every((l) => (l as unknown as Clickable).props.pickable !== true)).toBe(true);
    }
  });

  it("bus: la tarjeta se cierra al pasar a sin datos y no se puede reabrir mientras tanto", () => {
    const store = new LiveStore();
    store.apply({
      type: "items",
      layer: "bus",
      replace: true,
      upserts: [busEntity("a", { meta: { line: "1" } })],
      removes: [],
      receivedAt: T0,
      dataTs: T0,
    });
    store.apply({
      type: "frames",
      frames: [
        {
          layer: "bus",
          count: 1,
          idsVersion: 1,
          ids: ["a"],
          positions: new Float32Array([-8.4, 43.37]),
          headings: new Float32Array([0]),
        },
      ],
    });
    const { p, states } = build(bus, store);
    const halo = (): Clickable =>
      p.collect().find((l) => l.id === "bus-halo") as unknown as Clickable;

    halo().props.onClick?.({ index: 0 });
    p.collect();
    const card = document.querySelector<HTMLElement>(".bus-card");
    expect(card?.hidden).toBe(false);

    states["bus"] = "nodata";
    p.collect();
    expect(card?.hidden).toBe(true);
    expect(halo().props.pickable).toBe(false);

    // al volver el dato se puede volver a abrir
    states["bus"] = "live";
    p.collect();
    halo().props.onClick?.({ index: 0 });
    p.collect();
    expect(card?.hidden).toBe(false);
  });
});
