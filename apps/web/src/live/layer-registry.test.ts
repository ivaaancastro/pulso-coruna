import type { Layer } from "@deck.gl/core";
import { afterEach, describe, expect, it } from "vitest";
import { LayerPipeline } from "./layer-pipeline";
import {
  hasLiveLayers,
  listLiveLayers,
  loadLiveLayers,
  registerLiveLayer,
  resetLiveLayers,
  type LiveLayerDefinition,
} from "./layer-registry";
import { LiveStore } from "./live-store";

afterEach(resetLiveLayers);

const fakeLayer = (id: string) => ({ id }) as unknown as Layer;

function def(
  id: string,
  sources: LiveLayerDefinition["sources"],
  calls: string[],
  animated = false,
) {
  return {
    id,
    sources,
    animated,
    createLayers: () => {
      calls.push(id);
      return [fakeLayer(id)];
    },
  } satisfies LiveLayerDefinition;
}

describe("registro de capas", () => {
  it("registra, evita duplicados y es idempotente con la misma definición", () => {
    const calls: string[] = [];
    const bus = def("bus", ["bus"], calls);
    registerLiveLayer(bus);
    registerLiveLayer(bus);
    expect(listLiveLayers()).toHaveLength(1);
    expect(() => registerLiveLayer(def("bus", ["bus"], calls))).toThrow(/duplicada/);
    expect(hasLiveLayers()).toBe(true);
  });

  it("las capas descubiertas en layers/*.layer.ts se cargan una vez, con id y fuentes válidos", async () => {
    // Con capas en el árbol hay algo que arrancar; sin ellas, `hasLiveLayers` sería false.
    expect(hasLiveLayers()).toBe(true);
    const first = await loadLiveLayers();
    const second = await loadLiveLayers();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(first.length);
    expect(new Set(first.map((d) => d.id)).size).toBe(first.length);
    for (const d of first) expect(d.sources.length).toBeGreaterThan(0);
  }, 30_000); // la primera carga transforma deck.gl
});

describe("LayerPipeline", () => {
  const build = (defs: LiveLayerDefinition[]) =>
    new LayerPipeline({
      definitions: defs,
      store: new LiveStore(),
      now: () => 1,
      reducedMotion: () => false,
    });

  it("solo recrea las capas cuyas fuentes cambiaron", () => {
    const calls: string[] = [];
    const p = build([def("bus", ["bus"], calls), def("bici", ["bike"], calls)]);
    expect(p.collect().map((l) => l.id)).toEqual(["bus", "bici"]);
    calls.length = 0;
    expect(p.notify({ kind: "frames", layers: ["bus"] })).toBe(true);
    expect(p.collect().map((l) => l.id)).toEqual(["bus", "bici"]); // la de bici sale de caché
    expect(calls).toEqual(["bus"]);
    calls.length = 0;
    p.notify({ kind: "items", layer: "bike" });
    p.collect();
    expect(calls).toEqual(["bici"]);
  });

  it("un cambio de conexión reevalúa todas; las animadas, siempre", () => {
    const calls: string[] = [];
    const p = build([def("bus", ["bus"], calls), def("viento", ["weather"], calls, true)]);
    p.collect();
    calls.length = 0;
    p.collect();
    expect(calls).toEqual(["viento"]);
    expect(p.pending).toBe(true);
    calls.length = 0;
    p.notify({ kind: "connection" });
    p.collect();
    expect(calls.sort()).toEqual(["bus", "viento"]);
  });

  it("un error en una capa no tumba a las demás y conserva su última salida", () => {
    const errors: string[] = [];
    let boom = false;
    const bad: LiveLayerDefinition = {
      id: "mala",
      sources: ["sea"],
      createLayers: () => {
        if (boom) throw new Error("x");
        return [fakeLayer("mala")];
      },
    };
    const p = new LayerPipeline({
      definitions: [bad, def("bus", ["bus"], [])],
      store: new LiveStore(),
      now: () => 1,
      reducedMotion: () => false,
      onError: (id) => errors.push(id),
    });
    expect(p.collect().map((l) => l.id)).toEqual(["mala", "bus"]);
    boom = true;
    p.notify({ kind: "items", layer: "sea" });
    expect(p.collect().map((l) => l.id)).toEqual(["mala", "bus"]);
    expect(errors).toEqual(["mala"]);
  });

  it("invalidate recrea solo esa capa y pide un fotograma", () => {
    const calls: string[] = [];
    let ask = 0;
    let invalidate: (() => void) | undefined;
    const sel: LiveLayerDefinition = {
      id: "sel",
      sources: ["bus"],
      createLayers: (ctx) => {
        calls.push("sel");
        invalidate = ctx.invalidate;
        return [fakeLayer("sel")];
      },
    };
    const p = new LayerPipeline({
      definitions: [sel, def("bici", ["bike"], calls)],
      store: new LiveStore(),
      now: () => 1,
      reducedMotion: () => true,
      requestRender: () => ask++,
    });
    p.collect();
    calls.length = 0;
    p.collect();
    expect(calls).toEqual([]); // sin cambios, caché
    invalidate?.();
    expect(ask).toBe(1);
    p.collect();
    expect(calls).toEqual(["sel"]);
  });
});
