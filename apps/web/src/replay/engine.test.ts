import { describe, expect, it } from "vitest";
import { ReplayEngine } from "./engine";
import { buildActive, locate } from "./series";
import { W0, bikeWindow, emptyLayersWindow, mobileWindow } from "./test-helpers";
import { WINDOW_MS } from "./windows";

const T = (offsetMs: number): number => W0 + offsetMs;
const BOTH = { interpolate: true, emitItems: true } as const;

/** Un bus que va de (−8,40; 43,37) a (−8,39; 43,37) entre 10 s y 40 s de la ventana. */
const walker = mobileWindow(W0, "bus", [
  {
    id: "bus:1",
    meta: { line: "1A" },
    init: { dt: -20_000, lon: -8.41, lat: 43.37, heading: 90, speed: 5 },
    samples: [
      { ts: 10_000, lon: -8.4, lat: 43.37, heading: 90, speed: 5 },
      { ts: 40_000, lon: -8.39, lat: 43.37, heading: 90, speed: 5 },
    ],
  },
]);

describe("series: construcción y búsqueda", () => {
  it("locate devuelve la última muestra ≤ t (−1 antes de la primera)", () => {
    const t = Float64Array.from([10, 20, 30]);
    expect(locate(t, 5)).toBe(-1);
    expect(locate(t, 10)).toBe(0);
    expect(locate(t, 25)).toBe(1);
    expect(locate(t, 99)).toBe(2);
  });

  it("une el estado inicial y las muestras de la ventana y la siguiente, sin duplicar", () => {
    const next = mobileWindow(W0 + WINDOW_MS, "bus", [
      {
        id: "bus:1",
        init: { dt: -260_000, lon: -8.39, lat: 43.37 }, // la muestra de 40 s de la ventana anterior
        samples: [{ ts: 5_000, lon: -8.38, lat: 43.37 }],
      },
    ]);
    const set = buildActive(walker, next);
    const s = set.mobile.get("bus")?.[0];
    expect(Array.from(s?.t ?? [])).toEqual([
      T(-20_000),
      T(10_000),
      T(40_000),
      T(WINDOW_MS + 5_000),
    ]);
    expect(s?.meta).toEqual({ line: "1A" });
    expect(set.hasNext).toBe(true);
  });
});

describe("ReplayEngine: móviles", () => {
  it("interpola la posición entre dos muestras (hacia delante y hacia atrás)", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const at = (ms: number) => {
      const out = engine.tick(T(ms), BOTH);
      const f = out.frames.find((x) => x.layer === "bus");
      return f && f.count === 1 ? [f.positions[0], f.positions[1], f.headings[0]] : null;
    };
    const mid = at(25_000); // a medio camino entre 10 s y 40 s
    expect(mid?.[0]).toBeCloseTo(-8.395, 4);
    expect(mid?.[2]).toBeCloseTo(90, 3);
    expect(at(10_000)?.[0]).toBeCloseTo(-8.4, 4);
    // Hacia atrás: sin estado acumulado, vuelve exactamente a la misma posición.
    expect(at(40_000 - 1)?.[0]).toBeCloseTo(-8.39, 3);
    expect(at(25_000)?.[0]).toBeCloseTo(-8.395, 4);
  });

  it("antes de la primera muestra usa el estado inicial (interpola desde `init`)", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const f = engine.tick(T(0), BOTH).frames[0];
    // init en −20 s (−8,41) → muestra en 10 s (−8,40): t = 0 está a 2/3.
    expect(f?.positions[0]).toBeCloseTo(-8.41 + 0.01 * (20 / 30), 4);
  });

  it("tras la última muestra sin siguiente ventana se queda quieto y expira (hold)", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const held = engine.tick(T(100_000), BOTH).frames[0];
    expect(held?.count).toBe(1);
    expect(held?.positions[0]).toBeCloseTo(-8.39, 4);
    const gone = engine.tick(T(40_000 + 130_000), BOTH).frames[0]; // > holdMs del bus (120 s)
    expect(gone?.count).toBe(0);
  });

  it("un hueco mayor que maxGap no se desliza: queda quieto y salta a la nueva muestra", () => {
    const win = mobileWindow(W0, "bus", [
      {
        id: "b",
        samples: [
          { ts: 5_000, lon: -8.4, lat: 43.37 },
          { ts: 250_000, lon: -8.3, lat: 43.37 },
        ],
      },
    ]);
    const engine = new ReplayEngine();
    engine.setActive(buildActive(win, null));
    expect(engine.tick(T(100_000), BOTH).frames[0]?.positions[0]).toBeCloseTo(-8.4, 4);
    expect(engine.tick(T(160_000), BOTH).frames[0]?.count).toBe(0); // expiró
    expect(engine.tick(T(250_000), BOTH).frames[0]?.positions[0]).toBeCloseTo(-8.3, 4);
  });

  it("el rumbo interpola por el arco corto (350° → 10° pasa por 0)", () => {
    const win = mobileWindow(W0, "bus", [
      {
        id: "b",
        samples: [
          { ts: 0, lon: -8.4, lat: 43.37, heading: 350 },
          { ts: 20_000, lon: -8.4, lat: 43.371, heading: 10 },
        ],
      },
    ]);
    const engine = new ReplayEngine();
    engine.setActive(buildActive(win, null));
    const h = engine.tick(T(10_000), BOTH).frames[0]?.headings[0] ?? -1;
    expect(h === 0 || h < 0.5 || h > 359.5).toBe(true);
  });

  it("sin rumbo en la muestra, lo deriva de la marcha", () => {
    const win = mobileWindow(W0, "bus", [
      {
        id: "b",
        samples: [
          { ts: 0, lon: -8.4, lat: 43.37 },
          { ts: 20_000, lon: -8.399, lat: 43.37 }, // hacia el este
        ],
      },
    ]);
    const engine = new ReplayEngine();
    engine.setActive(buildActive(win, null));
    expect(engine.tick(T(10_000), BOTH).frames[0]?.headings[0]).toBeCloseTo(90, 0);
  });

  it("sin interpolación (reduced-motion) cada muestra se ve tal cual", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const f = engine.tick(T(25_000), { interpolate: false, emitItems: true }).frames[0];
    expect(f?.positions[0]).toBeCloseTo(-8.4, 4);
  });

  it("idsVersion solo cambia cuando entra o sale una entidad; ids solo viaja si cambió", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const a = engine.tick(T(11_000), BOTH).frames[0];
    const b = engine.tick(T(12_000), BOTH).frames[0];
    expect(a?.ids).toEqual(["bus:1"]);
    expect(b?.ids).toBeNull();
    expect(b?.idsVersion).toBe(a?.idsVersion);
    const gone = engine.tick(T(40_000 + 130_000), BOTH).frames[0];
    expect(gone?.idsVersion).toBeGreaterThan(a?.idsVersion ?? 0);
  });

  it("no emite fotograma si el instante no cambia (pausa) y sí si cambia la ventana", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    expect(engine.tick(T(20_000), BOTH).frames).toHaveLength(1);
    expect(engine.tick(T(20_000), BOTH).frames).toHaveLength(0);
    engine.setActive(buildActive(walker, null));
    expect(engine.tick(T(20_000), BOTH).frames).toHaveLength(1);
  });
});

describe("ReplayEngine: elementos", () => {
  it("el primer tick reinicia y sustituye cada capa; los siguientes solo mandan cambios", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    const first = engine.tick(T(20_000), BOTH);
    expect(first.reset).toBe(true);
    const ev = first.events.find((e) => e.layer === "bus");
    expect(ev?.replace).toBe(true);
    expect(ev?.upserts).toHaveLength(1);
    const item = ev?.upserts[0];
    expect(item).toMatchObject({ id: "bus:1", layer: "bus", ts: T(10_000), meta: { line: "1A" } });
    // Mismo estado → nada que emitir.
    expect(engine.tick(T(21_000), BOTH).events).toHaveLength(0);
    // Pasa a la muestra siguiente → un upsert con ts nuevo.
    const next = engine.tick(T(41_000), BOTH);
    expect(next.reset).toBe(false);
    expect(next.events[0]?.upserts[0]).toMatchObject({ ts: T(40_000) });
  });

  it("al retroceder reinicia (el almacén no admite datos que rejuvenezcan)", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    engine.tick(T(41_000), BOTH);
    const back = engine.tick(T(12_000), BOTH);
    expect(back.reset).toBe(true);
    expect(back.events.find((e) => e.layer === "bus")?.upserts[0]).toMatchObject({ ts: T(10_000) });
  });

  it("limita el ritmo: sin `emitItems` no emite, y el reinicio queda pendiente hasta que toque", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    engine.tick(T(41_000), BOTH);
    const quiet = engine.tick(T(12_000), { interpolate: true, emitItems: false });
    expect(quiet.reset).toBe(false);
    expect(quiet.events).toHaveLength(0);
    expect(quiet.frames).toHaveLength(1); // los fotogramas siguen al reloj
    const later = engine.tick(T(13_000), BOTH);
    expect(later.reset).toBe(true);
  });

  it("estaciones de bicis: último valor ≤ t como StationStatus", () => {
    const win = bikeWindow(W0, [
      {
        id: "st:1",
        init: { dt: -60_000, bikes: 2, docks: 8 },
        samples: [{ ts: 30_000, bikes: 4, docks: 6 }],
      },
    ]);
    const engine = new ReplayEngine();
    engine.setActive(buildActive(win, null));
    const a = engine.tick(T(10_000), BOTH);
    expect(a.events.find((e) => e.layer === "bike")?.upserts[0]).toMatchObject({
      id: "st:1",
      layer: "bike",
      bikes: 2,
      docks: 8,
      ts: T(-60_000),
    });
    const b = engine.tick(T(31_000), BOTH);
    expect(b.events.find((e) => e.layer === "bike")?.upserts[0]).toMatchObject({ bikes: 4 });
  });

  it("observaciones: serie meteo → Observation con la clave stationId:metric", () => {
    const win = {
      ...emptyLayersWindow(W0),
      layers: {
        weather: {
          kind: "series" as const,
          series: [
            {
              stationId: "m1",
              metric: "wind_speed",
              unit: "m/s",
              init: { dt: -60_000, value: 3 },
              ts: [100_000],
              value: [5.5],
            },
          ],
        },
      },
    };
    const engine = new ReplayEngine();
    engine.setActive(buildActive(win, null));
    const a = engine.tick(T(50_000), BOTH).events.find((e) => e.layer === "weather");
    expect(a?.upserts[0]).toMatchObject({ stationId: "m1", metric: "wind_speed", value: 3 });
    const b = engine.tick(T(150_000), BOTH).events.find((e) => e.layer === "weather");
    expect(b?.upserts[0]).toMatchObject({ value: 5.5, ts: T(100_000) });
  });
});

describe("ReplayEngine: sin datos", () => {
  it("ventana con capas vacías: noData y capas declaradas vacías (para M4.6)", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(emptyLayersWindow(W0), null));
    const out = engine.tick(T(10_000), BOTH);
    expect(out.noData).toBe(true);
    expect(out.reset).toBe(true);
    const layers = out.events.map((e) => e.layer).sort();
    expect(layers).toEqual(["bike", "bus", "weather"]);
    expect(out.events.every((e) => e.replace && e.upserts.length === 0)).toBe(true);
  });

  it("con datos noData es false", () => {
    const engine = new ReplayEngine();
    engine.setActive(buildActive(walker, null));
    expect(engine.tick(T(20_000), BOTH).noData).toBe(false);
  });

  it("sin ventana activa no hace nada", () => {
    const out = new ReplayEngine().tick(T(0), BOTH);
    expect(out).toEqual({ reset: false, frames: [], events: [], noData: false });
  });
});
