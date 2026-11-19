import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveLayerDefinition } from "../layer-registry";
import { TRAIL_PRESETS, busTrailConfig } from "../layers/bus/trail-config";
import { WIND_QUALITY_BY_LEVEL, createWindLayer } from "../wind/wind-layer";
import { parsePerfOverride, startAutoQuality } from "./auto-quality";
import type { QualityLevel } from "./monitor";

afterEach(() => busTrailConfig.setQuality("high"));

function harness(defs: LiveLayerDefinition[], extra = {}) {
  let cb: ((t: number) => void) | null = null;
  const doc = Object.assign(new EventTarget(), { hidden: false }) as unknown as Document;
  const q = startAutoQuality({
    definitions: defs,
    raf: (c) => {
      cb = c;
      return 1;
    },
    cancel: () => {
      cb = null;
    },
    doc,
    ...extra,
  });
  let t = 0;
  return {
    q,
    run(fps: number, ms: number) {
      const end = t + ms;
      while (t < end) {
        t += 1000 / fps;
        cb?.(t);
      }
    },
  };
}

const spy = (levels: QualityLevel[]): LiveLayerDefinition => ({
  id: "spy",
  sources: [],
  createLayers: () => [],
  setQualityLevel: (l) => levels.push(l),
});

describe("startAutoQuality", () => {
  it("aplica el nivel a las capas con setQualityLevel y salta las que no lo tienen", () => {
    const levels: QualityLevel[] = [];
    const plain: LiveLayerDefinition = { id: "plain", sources: [], createLayers: () => [] };
    const h = harness([plain, spy(levels)]);
    expect(levels).toEqual(["high"]);
    h.run(60, 6000);
    h.run(25, 15_000);
    expect(levels).toEqual(["high", "medium", "low"]);
    expect(h.q.level).toBe("low");
  });

  it("mapea a viento (factor) y a estelas de bus (preset)", () => {
    const wind = createWindLayer();
    const bus: LiveLayerDefinition = {
      id: "bus",
      sources: [],
      createLayers: () => [],
      setQualityLevel: (l) => busTrailConfig.setQuality(l),
    };
    const h = harness([wind, bus]);
    h.run(60, 6000);
    h.run(25, 4000);
    expect(wind.getQuality()).toBe(WIND_QUALITY_BY_LEVEL.medium);
    expect(busTrailConfig.settings).toEqual(TRAIL_PRESETS.medium);
    h.run(25, 4000);
    expect(wind.getQuality()).toBe(WIND_QUALITY_BY_LEVEL.low);
    expect(busTrailConfig.settings).toEqual(TRAIL_PRESETS.low);
  });

  it("con reduced-motion no mide", () => {
    const levels: QualityLevel[] = [];
    const h = harness([spy(levels)], {
      motion: { matches: true, addEventListener: () => undefined },
    });
    h.run(60, 6000);
    h.run(10, 20_000);
    expect(h.q.level).toBe("high");
  });

  it("forced fija el nivel y no degrada ni recupera", () => {
    const levels: QualityLevel[] = [];
    const h = harness([spy(levels)], { forced: "low" });
    h.run(60, 40_000);
    expect(levels).toEqual(["low"]);
  });

  it("onChange y destroy", () => {
    const onChange = vi.fn();
    const h = harness([], { onChange });
    h.run(60, 6000);
    h.run(25, 4000);
    expect(onChange).toHaveBeenLastCalledWith("medium", expect.any(Number));
    h.q.destroy();
    h.run(25, 10_000);
    expect(h.q.level).toBe("medium");
  });
});

describe("parsePerfOverride", () => {
  it("solo acepta niveles válidos", () => {
    expect(parsePerfOverride("?perf=low")).toBe("low");
    expect(parsePerfOverride("?perf=medium")).toBe("medium");
    expect(parsePerfOverride("?perf=ultra")).toBeNull();
    expect(parsePerfOverride("")).toBeNull();
  });
});
