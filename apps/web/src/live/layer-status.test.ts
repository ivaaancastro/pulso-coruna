import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { describe, expect, it, vi } from "vitest";
import { LayerPipeline } from "./layer-pipeline";
import type { LiveLayerDefinition } from "./layer-registry";
import { LiveStore } from "./live-store";
import type { SourceState } from "./source-status";

const dot = (id: string, over: Record<string, unknown> = {}): Layer =>
  new ScatterplotLayer({ id, data: [], getPosition: () => [0, 0], pickable: true, ...over });

function def(id: string, over: Partial<LiveLayerDefinition> = {}): LiveLayerDefinition {
  return {
    id,
    sources: ["bus"],
    createLayers: () => [dot(`${id}-a`), dot(`${id}-b`, { opacity: 0.5 })],
    ...over,
  };
}

function setup(defs: LiveLayerDefinition[], states: Record<string, SourceState>, extra = {}) {
  let t = 0;
  const onError = vi.fn();
  const p = new LayerPipeline({
    definitions: defs,
    store: new LiveStore(),
    now: () => 1,
    reducedMotion: () => false,
    status: (d) => states[d.id] ?? "live",
    mutedOpacity: 0.35,
    fadeMs: 600,
    clock: () => t,
    onError,
    ...extra,
  });
  const at = (ms: number) => {
    t = ms;
    return p.collect();
  };
  return { p, at, onError, states };
}

const opacity = (l: Layer): number => (l.props as { opacity: number }).opacity;
const pickable = (l: Layer): boolean => (l.props as { pickable: boolean }).pickable;

describe("LayerPipeline: atenuación por estado de la fuente", () => {
  it("vivo: las capas pasan tal cual (misma instancia)", () => {
    const { at, p } = setup([def("x")], {});
    const first = at(0);
    expect(first.map(opacity)).toEqual([1, 0.5]);
    expect(at(10)[0]).toBe(first[0]); // sin recrear ni clonar
    expect(p.isFading).toBe(false);
  });

  it("sin datos: opacidad × token y no seleccionable, sin que la capa haga nada", () => {
    const { at, states } = setup([def("x")], {});
    at(0);
    states["x"] = "nodata";
    at(100);
    const done = at(100 + 600);
    expect(done.map(opacity)).toEqual([0.35, 0.5 * 0.35]);
    expect(done.map(pickable)).toEqual([false, false]);
    // conserva id y datos
    expect(done.map((l) => l.id)).toEqual(["x-a", "x-b"]);
  });

  it("el fundido es progresivo, pide más fotogramas y termina", () => {
    const { at, p, states } = setup([def("x")], {});
    at(0);
    states["x"] = "nodata";
    at(10); // arranca el fundido
    const mid = at(310);
    expect(opacity(mid[0] as Layer)).toBeLessThan(1);
    expect(opacity(mid[0] as Layer)).toBeGreaterThan(0.35);
    expect(p.isFading).toBe(true);
    expect(p.pending).toBe(true);
    at(1000);
    expect(opacity(at(1000)[0] as Layer)).toBe(0.35);
    expect(p.isFading).toBe(false);
  });

  it("al recuperarse vuelve a opacidad completa y seleccionable", () => {
    const { at, states } = setup([def("x")], {});
    at(0);
    states["x"] = "nodata";
    at(10);
    at(2000);
    states["x"] = "live";
    at(2100);
    const back = at(3000);
    expect(back.map(opacity)).toEqual([1, 0.5]);
    expect(back.map(pickable)).toEqual([true, true]);
  });

  it("retrasado y desconectado atenúan menos que sin datos, y siguen seleccionables", () => {
    const run = (state: SourceState) => {
      const { at } = setup([def("x")], { x: state });
      at(0);
      return opacity(at(5000)[0] as Layer);
    };
    expect(run("delayed")).toBeGreaterThan(run("disconnected"));
    expect(run("disconnected")).toBeGreaterThan(run("nodata"));
    const { at } = setup([def("x")], { x: "disconnected" });
    expect(pickable(at(0)[0] as Layer)).toBe(true);
  });

  it("con reduced-motion el cambio es inmediato", () => {
    const { at, states } = setup([def("x")], {}, { reducedMotion: () => true });
    at(0);
    states["x"] = "nodata";
    expect(opacity(at(1)[0] as Layer)).toBe(0.35);
  });

  it("solo afecta a la definición con la fuente caída", () => {
    const { at } = setup([def("a"), def("b")], { a: "nodata" });
    const out = at(1000);
    expect(opacity(out[0] as Layer)).toBeCloseTo(0.35);
    expect(opacity(out[2] as Layer)).toBe(1);
  });

  it("onSourceState se llama una vez por transición, tras el fotograma (puede invalidar)", () => {
    const calls: SourceState[] = [];
    let invalidate: (() => void) | null = null;
    const d = def("x", {
      createLayers: (ctx) => {
        invalidate = ctx.invalidate;
        return [dot("x-a")];
      },
      onSourceState: (s) => {
        calls.push(s);
        invalidate?.();
      },
    });
    const { at, p, states } = setup([d], {});
    at(0);
    expect(calls).toEqual([]);
    states["x"] = "nodata";
    at(10);
    at(20);
    expect(calls).toEqual(["nodata"]);
    // la invalidación hecha desde el hook sobrevive a la limpieza del fotograma
    expect(p.pending).toBe(true);
    states["x"] = "live";
    at(30);
    expect(calls).toEqual(["nodata", "live"]);
  });

  it("un hook o un estado que fallan no tumban nada", () => {
    const d = def("x", {
      onSourceState: () => {
        throw new Error("hook");
      },
    });
    const { at, onError, states } = setup([d], {});
    at(0);
    states["x"] = "nodata";
    expect(() => at(10)).not.toThrow();
    expect(onError).toHaveBeenCalledWith("x", expect.any(Error));

    const { at: at2, onError: err2 } = setup(
      [def("y")],
      {},
      {
        status: () => {
          throw new Error("estado");
        },
      },
    );
    expect(at2(0)).toHaveLength(2);
    expect(err2).toHaveBeenCalled();
  });

  it("touch() marca trabajo pendiente hasta el siguiente fotograma", () => {
    const { p, at } = setup([def("x")], {});
    at(0);
    expect(p.pending).toBe(false);
    p.touch();
    expect(p.pending).toBe(true);
    at(1);
    expect(p.pending).toBe(false);
  });

  it("sin `status` el pipeline se comporta como antes", () => {
    const p = new LayerPipeline({
      definitions: [def("x")],
      store: new LiveStore(),
      now: () => 1,
      reducedMotion: () => false,
    });
    expect(p.collect().map(opacity)).toEqual([1, 0.5]);
  });
});
