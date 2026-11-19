import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerPipeline } from "../layer-pipeline";
import type { LiveLayerContext } from "../layer-registry";
import { LiveStore } from "../live-store";
import type { SourceState } from "../source-status";
import { air as obs, T0 } from "../test-helpers";
import { LEVEL_STYLE } from "../air/model";
import air from "./air.layer";

type Props = Record<string, unknown>;
const props = (l: unknown): Props => (l as { props: Props }).props;

let received = T0;
function storeWith(eaqi: number | null): LiveStore {
  const store = new LiveStore();
  const upserts = [obs("pm25", 3.6), obs("pm10", 10), obs("no2", 2.6)];
  if (eaqi !== null) upserts.push(obs("eaqi", eaqi));
  store.apply({
    type: "items",
    layer: "air",
    replace: true,
    upserts,
    removes: [],
    receivedAt: ++received,
    dataTs: T0,
  });
  return store;
}

const ctx = (store: LiveStore, reducedMotion = false): LiveLayerContext => ({
  store,
  now: T0,
  reducedMotion,
  invalidate: vi.fn(),
});

afterEach(() => {
  air.setQualityLevel?.("high");
  vi.restoreAllMocks();
});

describe("air.layer (contrato del registro)", () => {
  it("se suscribe a la capa air", () => {
    expect(air.id).toBe("air");
    expect(air.sources).toEqual(["air"]);
  });

  it("sin datos o sin EAQI no dibuja nada ni muestra etiqueta", () => {
    expect(air.createLayers(ctx(new LiveStore()))).toEqual([]);
    expect(air.createLayers(ctx(storeWith(null)))).toEqual([]);
    expect(document.querySelector(".air-badge")).toBeNull();
  });

  it("un halo único (discos concéntricos, sin trazo) y una zona de toque", () => {
    const layers = air.createLayers(ctx(storeWith(29)));
    expect(layers.map((l) => l.id)).toEqual(["air-halo", "air-hit"]);
    const [halo, hit] = layers.map(props) as [Props, Props];
    const data = halo["data"] as { position: number[]; radius: number }[];
    expect(data).toHaveLength(24);
    // un solo centro: sin variación espacial
    expect(new Set(data.map((d) => d.position.join()))).toEqual(new Set(["-8.4115,43.3623"]));
    expect(Math.max(...data.map((d) => d.radius))).toBe(LEVEL_STYLE[2].radiusM);
    expect(halo["stroked"]).toBe(false);
    expect(halo["pickable"]).toBe(false);
    expect(hit["pickable"]).toBe(true);
    expect(hit["radiusMinPixels"]).toBeGreaterThanOrEqual(22);
    expect(document.querySelector(".air-badge")).not.toBeNull();
  });

  it("el color sale de la escala por nivel (violeta bueno, ámbar mala)", () => {
    const colour = (eaqi: number) => {
      const [halo] = air.createLayers(ctx(storeWith(eaqi)));
      const fn = props(halo)["getFillColor"] as (d: { alpha: number }) => number[];
      return fn({ alpha: 5 });
    };
    expect(colour(10)).toEqual([167, 139, 250, 5]);
    expect(colour(70)).toEqual([255, 176, 32, 5]);
  });

  it("los discos conservan la misma referencia mientras nada cambia", () => {
    const store = storeWith(29);
    const a = props(air.createLayers(ctx(store))[0])["data"];
    const b = props(air.createLayers(ctx(store))[0])["data"];
    expect(b).toBe(a);
  });

  it("con reduced-motion no respira: escala y opacidad fijas", () => {
    for (const ms of [0, 1500, 3000, 4500]) {
      vi.spyOn(performance, "now").mockReturnValue(ms);
      const [halo] = air.createLayers(ctx(storeWith(90), true));
      expect(props(halo)["radiusScale"]).toBe(1);
    }
    const opacities = new Set<unknown>();
    for (const ms of [0, 1500, 3000, 4500]) {
      vi.spyOn(performance, "now").mockReturnValue(ms);
      opacities.add(props(air.createLayers(ctx(storeWith(90), true))[0])["opacity"]);
    }
    expect(opacities.size).toBe(1);
    vi.restoreAllMocks();
  });

  it("sin reduced-motion respira con periodo de 6 s", () => {
    const store = storeWith(90);
    vi.spyOn(performance, "now").mockReturnValue(3000);
    const [peak] = air.createLayers(ctx(store));
    expect(props(peak)["radiusScale"] as number).toBeGreaterThan(1);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const rest0 = air.createLayers(ctx(store))[0];
    expect(props(peak)["opacity"] as number).toBeLessThan(props(rest0)["opacity"] as number);
    vi.spyOn(performance, "now").mockReturnValue(6000);
    const [rest] = air.createLayers(ctx(store));
    expect(props(rest)["radiusScale"] as number).toBeCloseTo(1, 10);
    vi.restoreAllMocks();
  });

  it("degradación: medium menos discos; low menos discos y sin respirar", () => {
    const store = storeWith(90);
    vi.spyOn(performance, "now").mockReturnValue(3000);
    air.setQualityLevel?.("medium");
    let [halo] = air.createLayers(ctx(store));
    expect((props(halo)["data"] as unknown[]).length).toBe(14);
    expect(props(halo)["radiusScale"] as number).toBeGreaterThan(1);
    air.setQualityLevel?.("low");
    [halo] = air.createLayers(ctx(store));
    expect((props(halo)["data"] as unknown[]).length).toBe(8);
    expect(props(halo)["radiusScale"]).toBe(1);
    vi.restoreAllMocks();
  });

  it("tocar el halo abre y cierra la tarjeta", () => {
    const layers = air.createLayers(ctx(storeWith(29)));
    const onClick = props(layers[1])["onClick"] as () => boolean;
    const panel = document.querySelector<HTMLElement>(".air-card");
    expect(panel?.hidden).toBe(true);
    expect(onClick()).toBe(true);
    expect(panel?.hidden).toBe(false);
    onClick();
    expect(panel?.hidden).toBe(true);
  });
});

describe("estado de la fuente (M4.6)", () => {
  it("en «sin datos» se cierra la tarjeta, se oculta la etiqueta y la capa no es seleccionable", () => {
    const store = storeWith(29);
    const states: Record<string, SourceState> = {};
    const p = new LayerPipeline({
      definitions: [air],
      store,
      now: () => T0,
      reducedMotion: () => true,
      status: (d) => states[d.id] ?? "live",
    });
    const hit = () => p.collect().find((l) => l.id === "air-hit");
    (props(hit())["onClick"] as () => boolean)();
    const panel = document.querySelector<HTMLElement>(".air-card");
    const badge = document.querySelector<HTMLElement>(".air-badge");
    expect(panel?.hidden).toBe(false);

    states["air"] = "delayed"; // retrasado: se queda (la tarjeta ya dice «Actualizado hace X»)
    p.collect();
    expect(panel?.hidden).toBe(false);
    expect(badge?.hidden).toBe(false);

    states["air"] = "nodata";
    p.collect();
    expect(panel?.hidden).toBe(true);
    expect(badge?.hidden).toBe(true);
    expect(props(hit())["pickable"]).toBe(false);

    states["air"] = "live";
    p.collect();
    expect(badge?.hidden).toBe(false);
  });
});
