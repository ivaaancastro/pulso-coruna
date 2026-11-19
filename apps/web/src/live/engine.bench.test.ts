import { describe, expect, it } from "vitest";
import type { Entity } from "@pulso/schema";
import { LiveEngine } from "./engine";
import { MockWorld } from "./dev/mock-sim";
import { LiveStore } from "./live-store";
import type { WorkerOutput } from "./types";

/**
 * Banco reproducible (semilla fija, sin red): 2000 entidades simuladas. Mide lo que cuesta cada
 * fotograma en el worker (`engine.frames`) y lo único que hace el hilo principal con él
 * (`LiveStore.apply`). El presupuesto es 8 ms por fotograma en el hilo principal; aquí se exige
 * mucho menos porque en Node/CI el tiempo es ruidoso. La medición en navegador está en la spec.
 */
const ENTITIES = 2000;
const FRAMES = 300;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

describe(`banco: ${ENTITIES} entidades`, () => {
  it("el fotograma interpolado y su aplicación en el hilo principal caben en el presupuesto", () => {
    const world = new MockWorld({ buses: ENTITIES, seed: 7, busIntervalMs: 2000 });
    const engine = new LiveEngine();
    const store = new LiveStore();
    let clock = 1_760_000_000_000;
    const snap = world.snapshot(clock);
    const items = (snap.layers.bus ?? []) as Entity[];
    expect(items.length).toBeGreaterThan(ENTITIES * 0.95);
    engine.handle(snap, clock);

    const workerMs: number[] = [];
    const mainMs: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
      clock += 16;
      for (const d of world.step(clock)) engine.handle(d, clock);

      const t0 = performance.now();
      const frames = engine.frames(clock);
      const spent = performance.now() - t0;
      if (frames.length === 0) continue; // reposo: nada que entregar
      workerMs.push(spent);

      // Estructurado como lo recibe el hilo principal tras el postMessage (sin copiar buffers).
      const out: WorkerOutput = { type: "frames", frames };
      const t1 = performance.now();
      store.apply(out);
      mainMs.push(performance.now() - t1);
    }

    expect(workerMs.length).toBeGreaterThan(FRAMES / 2);
    const w = median(workerMs);
    const m = median(mainMs);
    console.info(
      `[bench ${ENTITIES}] worker frames() mediana ${w.toFixed(3)} ms (${workerMs.length}/${FRAMES} fotogramas con datos), hilo principal apply() mediana ${m.toFixed(3)} ms`,
    );
    expect(store.frame("bus")?.count).toBeGreaterThan(ENTITIES * 0.9);
    expect(m).toBeLessThan(1); // el hilo principal solo guarda una referencia
    expect(w).toBeLessThan(8); // y el worker, aun a 8 ms, tiene un fotograma entero para sí
  });
});
