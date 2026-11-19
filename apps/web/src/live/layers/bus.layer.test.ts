import type { Entity } from "@pulso/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStore } from "../live-store";
import { LayerPipeline } from "../layer-pipeline";
import { bus as busEntity, T0 } from "../test-helpers";
import busLayer from "./bus.layer";
import { busTrailConfig } from "./bus/trail-config";

function storeWith(entities: Entity[], positions: number[], headings: number[]): LiveStore {
  const store = new LiveStore();
  store.apply({
    type: "items",
    layer: "bus",
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
        layer: "bus",
        count: entities.length,
        idsVersion: 1,
        ids: entities.map((e) => e.id),
        positions: new Float32Array(positions),
        headings: new Float32Array(headings),
      },
    ],
  });
  return store;
}

const pipeline = (store: LiveStore, reducedMotion = false, now = T0) =>
  new LayerPipeline({
    definitions: [busLayer],
    store,
    now: () => now,
    reducedMotion: () => reducedMotion,
  });

afterEach(() => {
  busTrailConfig.setQuality("high");
  vi.restoreAllMocks();
});

describe("capa bus (definición)", () => {
  it("cumple el contrato del registro", () => {
    expect(busLayer.id).toBe("bus");
    expect(busLayer.sources).toEqual(["bus"]);
    expect(busLayer.animated).toBe(true);
  });

  it("sin datos de bus no dibuja nada y no escribe en consola", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(pipeline(new LiveStore()).collect()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("con datos devuelve capas con id estable entre fotogramas", () => {
    const store = storeWith(
      [busEntity("a", { meta: { line: "1" } }), busEntity("b", { meta: { line: "2" } })],
      [-8.4, 43.37, -8.41, 43.371],
      [0, 90],
    );
    const p = pipeline(store);
    const first = p.collect().map((l) => l.id);
    p.notify({ kind: "frames", layers: ["bus"] });
    const second = p.collect().map((l) => l.id);
    expect(first).toContain("bus-trails");
    expect(first).toContain("bus-icons");
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("con reduced-motion no hay estelas, solo puntos", () => {
    const store = storeWith([busEntity("a")], [-8.4, 43.37], [0]);
    const layers = pipeline(store, true).collect();
    const trails = layers.find((l) => l.id === "bus-trails");
    expect((trails?.props.data as { length: number }).length).toBe(0);
    expect(layers.some((l) => l.id === "bus-icons")).toBe(true);
  });

  it("la calidad ajustable acorta la estela del fotograma siguiente", () => {
    const store = storeWith([busEntity("a")], [-8.4, 43.37], [0]);
    const trailLength = (p: LayerPipeline): number =>
      (p.collect().find((l) => l.id === "bus-trails")?.props as unknown as { trailLength: number })
        .trailLength;
    const p = pipeline(store);
    const high = trailLength(p);
    busTrailConfig.setQuality("low");
    p.notify({ kind: "connection" });
    expect(trailLength(p)).toBeLessThan(high);
  });

  it("coste de createLayers con estelas completas (flota real ~200 buses; 2000 solo informativo)", () => {
    const n = Number(process.env.BUS_BENCH_N ?? 600);
    const entities = Array.from({ length: n }, (_, i) =>
      busEntity(`b${i}`, { meta: { line: String(i % 12) } }),
    );
    const pos = (k: number): number[] =>
      entities.flatMap((_, i) => [
        -8.42 + (i % 50) * 0.0004 + k * 0.00001,
        43.36 + Math.floor(i / 50) * 0.0004,
      ]);
    const store = storeWith(entities, pos(0), new Array(n).fill(45));
    let now = T0;
    const p = new LayerPipeline({
      definitions: [busLayer],
      store,
      now: () => now,
      reducedMotion: () => false,
    });
    const times: number[] = [];
    for (let k = 0; k < 150; k++) {
      now += 100; // ~25 s de histórico a 10 fotogramas/s simulados
      store.apply({
        type: "frames",
        frames: [
          {
            layer: "bus",
            count: n,
            idsVersion: 1,
            ids: null,
            positions: new Float32Array(pos(k)),
            headings: new Float32Array(n),
          },
        ],
      });
      p.notify({ kind: "frames", layers: ["bus"] });
      const t0 = performance.now();
      p.collect();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] as number;
    console.info(
      `createLayers ${n} buses: mediana ${median.toFixed(2)} ms, p95 ${(times[Math.floor(times.length * 0.95)] as number).toFixed(2)} ms`,
    );
    expect(median).toBeLessThan(8);
  });
});
