import type { Layer } from "@deck.gl/core";
import { describe, expect, it, vi } from "vitest";
import { LayerPipeline } from "./layer-pipeline";
import type { LiveLayerContext, LiveLayerDefinition } from "./layer-registry";
import { LiveStore } from "./live-store";

describe("LiveLayerContext.invalidate", () => {
  it("marca solo su capa como sucia y pide un fotograma", () => {
    const ctxs: Record<string, LiveLayerContext> = {};
    const calls: string[] = [];
    const def = (id: string): LiveLayerDefinition => ({
      id,
      sources: [],
      createLayers: (ctx) => {
        ctxs[id] = ctx;
        calls.push(id);
        return [{ id } as unknown as Layer];
      },
    });
    const onInvalidate = vi.fn();
    const p = new LayerPipeline({
      definitions: [def("a"), def("b")],
      store: new LiveStore(),
      now: () => 1,
      reducedMotion: () => false,
      onInvalidate,
    });
    p.collect();
    calls.length = 0;
    expect(p.pending).toBe(false);

    ctxs["b"]?.invalidate();
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(p.pending).toBe(true);
    p.collect();
    expect(calls).toEqual(["b"]);
    expect(p.pending).toBe(false);
  });
});
