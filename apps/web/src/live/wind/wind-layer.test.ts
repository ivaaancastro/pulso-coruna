import { describe, expect, it } from "vitest";
import { LiveStore } from "../live-store";
import type { LiveLayerContext } from "../layer-registry";
import { T0, wind } from "../test-helpers";
import { buildArrows, gridStep, GRID_STEP_M } from "./arrows";
import { createWindField, windToVector } from "./field";
import { createRng } from "./particles";
import { alphaForElevation, windStyle, WIND_RGB } from "./style";
import { createWindLayer } from "./wind-layer";
import windLayerDefault from "../layers/wind.layer";

const REAL = [
  wind("14000", { metric: "wind_speed", value: 6, ts: T0 }),
  wind("14000", { metric: "wind_dir", value: 270, unit: "deg", ts: T0 }),
  wind("14003", { metric: "wind_speed", value: 9, ts: T0 }),
  wind("14003", { metric: "wind_dir", value: 300, unit: "deg", ts: T0 }),
];

function storeWith(items: ReturnType<typeof wind>[], receivedAt = T0): LiveStore {
  const store = new LiveStore();
  store.apply({
    type: "items",
    layer: "weather",
    replace: true,
    upserts: items,
    removes: [],
    receivedAt,
    dataTs: T0,
  });
  return store;
}

// Reloj de animación de las pruebas: sigue al `now` del último contexto creado.
let clockNow = 0;
const clock = (): number => clockNow;
const ctx = (store: LiveStore, now: number, reducedMotion = false): LiveLayerContext => {
  clockNow = now;
  return { store, now, reducedMotion };
};

describe("contrato del registro", () => {
  it("wind.layer exporta por defecto una definición válida y animada", () => {
    expect(windLayerDefault.id).toBe("wind");
    expect(windLayerDefault.sources).toEqual(["weather"]);
    expect(windLayerDefault.animated).toBe(true);
    expect(typeof windLayerDefault.createLayers).toBe("function");
    expect(typeof windLayerDefault.setQuality).toBe("function");
  });
});

describe("capa de viento", () => {
  it("sin datos no devuelve capas ni lanza", () => {
    const layer = createWindLayer({ clock, maxParticles: 100 });
    const store = new LiveStore();
    expect(layer.createLayers(ctx(store, T0))).toEqual([]);
    expect(layer.createLayers(ctx(store, T0 + 16))).toEqual([]);
    expect(layer.createLayers(ctx(store, T0 + 16, true))).toEqual([]);
  });

  it("con datos caducados no dibuja nada", () => {
    const layer = createWindLayer({ clock, maxParticles: 100 });
    const store = storeWith(REAL);
    const later = T0 + 2 * 60 * 60 * 1000;
    expect(layer.createLayers(ctx(store, later))).toEqual([]);
  });

  it("con datos devuelve una capa de líneas con el mismo id en cada fotograma", () => {
    const layer = createWindLayer({ clock, maxParticles: 200, rng: createRng(1) });
    const store = storeWith(REAL);
    let now = T0;
    let out = layer.createLayers(ctx(store, now));
    for (let i = 0; i < 120; i++) {
      now += 16;
      out = layer.createLayers(ctx(store, now));
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("wind-flow");
  });

  it("los datos caducan con el tiempo aunque no lleguen mensajes", () => {
    const layer = createWindLayer({ clock, maxParticles: 100, rng: createRng(1) });
    const store = storeWith(REAL);
    let now = T0;
    for (let i = 0; i < 90; i++) layer.createLayers(ctx(store, (now += 16)));
    expect(layer.createLayers(ctx(store, now + 61 * 60 * 1000))).toEqual([]);
  });

  it("setQuality / getQuality recortan a [0,1] (mínimo 0,1)", () => {
    const layer = createWindLayer({ clock, maxParticles: 100 });
    expect(layer.getQuality()).toBe(1);
    layer.setQuality(0.4);
    expect(layer.getQuality()).toBe(0.4);
    layer.setQuality(5);
    expect(layer.getQuality()).toBe(1);
    layer.setQuality(-3);
    expect(layer.getQuality()).toBe(0.1);
  });

  it("la calidad reduce las partículas dibujadas", () => {
    const count = (q: number): number => {
      const layer = createWindLayer({ clock, maxParticles: 400, rng: createRng(2), quality: q });
      const store = storeWith(REAL);
      let now = T0;
      let out: ReturnType<typeof layer.createLayers> = [];
      for (let i = 0; i < 240; i++) out = layer.createLayers(ctx(store, (now += 16)));
      const data = (out[0]?.props as unknown as { data: { length: number } }).data;
      return data.length;
    };
    expect(count(1)).toBeGreaterThan(count(0.3));
    expect(count(0.3)).toBeGreaterThan(0);
  });

  it("reduced-motion: trazos fijos, la misma capa estática mientras no cambien los datos", () => {
    const layer = createWindLayer({ clock, maxParticles: 400, rng: createRng(2) });
    const store = storeWith(REAL);
    const a = layer.createLayers(ctx(store, T0, true));
    const b = layer.createLayers(ctx(store, T0 + 16, true));
    expect(a).toHaveLength(1);
    expect(a[0]?.id).toBe("wind-arrows");
    const buf = (l: typeof a): Float32Array =>
      (
        l[0]?.props as unknown as {
          data: { attributes: { getSourcePosition: { value: Float32Array } } };
        }
      ).data.attributes.getSourcePosition.value;
    expect(buf(b)).toBe(buf(a)); // mismo búfer: no se recalcula ni se anima
  });

  it("reduced-motion: cambia la rejilla con la calidad", () => {
    const layer = createWindLayer({ clock, maxParticles: 100 });
    const store = storeWith(REAL);
    const len = (): number =>
      (
        layer.createLayers(ctx(store, T0, true))[0]?.props as unknown as {
          data: { length: number };
        }
      ).data.length;
    const full = len();
    layer.setQuality(0.25);
    expect(len()).toBeLessThan(full);
  });
});

describe("reduced-motion: flechas estáticas", () => {
  const field = createWindField([
    { stationId: "A", lon: -8.4, lat: 43.37, ...windToVector(8, 270) },
  ]);

  it("las flechas apuntan hacia donde va el aire y la longitud crece con la velocidad", () => {
    const arrows = buildArrows(field, 1, WIND_RGB, 1);
    expect(arrows.count).toBeGreaterThan(0);
    // Primer segmento (eje): del oeste hacia el este y a la misma latitud.
    expect(arrows.target[0] as number).toBeGreaterThan(arrows.source[0] as number);
    expect(arrows.target[1]).toBeCloseTo(arrows.source[1] as number, 9);
    const strong = createWindField([
      { stationId: "A", lon: -8.4, lat: 43.37, ...windToVector(12, 270) },
    ]);
    const weak = createWindField([
      { stationId: "A", lon: -8.4, lat: 43.37, ...windToVector(3, 270) },
    ]);
    const len = (f: typeof strong): number => {
      const a = buildArrows(f, 1, WIND_RGB, 1);
      return (a.target[0] as number) - (a.source[0] as number);
    };
    expect(len(strong)).toBeGreaterThan(len(weak));
  });

  it("menos calidad, menos flechas; sin campo, ninguna", () => {
    expect(buildArrows(field, 0.25, WIND_RGB, 1).count).toBeLessThan(
      buildArrows(field, 1, WIND_RGB, 1).count,
    );
    expect(gridStep(0.25)).toBeCloseTo(GRID_STEP_M * 2, 6);
    expect(buildArrows(createWindField([]), 1, WIND_RGB, 1).count).toBe(0);
  });

  it("no dibuja flechas en calma", () => {
    const calm = createWindField([
      { stationId: "A", lon: -8.4, lat: 43.37, ...windToVector(0, 0) },
    ]);
    expect(buildArrows(calm, 1, WIND_RGB, 1).count).toBe(0);
  });
});

describe("estilo", () => {
  it("usa el color del token --pulso-wind (#C9DCF5)", () => {
    expect(WIND_RGB).toEqual([0xc9, 0xdc, 0xf5]);
    expect(windStyle(Date.UTC(2026, 10, 18, 2)).rgb).toEqual(WIND_RGB);
  });

  it("de noche algo más tenue que de día, siempre dentro de [0,1]", () => {
    const night = windStyle(Date.UTC(2026, 10, 18, 2)).alpha;
    const day = windStyle(Date.UTC(2026, 5, 18, 12)).alpha;
    expect(night).toBeLessThan(day);
    expect(night).toBeCloseTo(0.85, 6);
    expect(alphaForElevation(90)).toBeLessThanOrEqual(1);
    expect(alphaForElevation(-90)).toBeGreaterThanOrEqual(0.85);
  });
});
