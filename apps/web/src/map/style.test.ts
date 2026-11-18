import { describe, expect, it } from "vitest";
import { paletteAt } from "./palette";
import {
  EXTRUSION_BASE,
  EXTRUSION_HEIGHT,
  FONT,
  SOURCE_ID,
  TORRE_SOURCE_ID,
  USED_SOURCE_LAYERS,
  buildStyle,
} from "./style";

const ORIGIN = "https://pulso.test";
const style = buildStyle(paletteAt(Date.parse("2026-11-18T22:30:00Z")), {
  tilesUrl: `pmtiles://${ORIGIN}/tiles/coruna.pmtiles`,
  glyphsUrl: `${ORIGIN}/glyphs/{fontstack}/{range}.pbf`,
});

type Paint = Record<string, unknown>;
const paintOf = (id: string): Paint =>
  (style.layers.find((l) => l.id === id) as unknown as { paint: Paint }).paint;

describe("estilo Faro", () => {
  it("es un estilo v8 con ids de capa únicos y fondo en primer lugar", () => {
    expect(style.version).toBe(8);
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(style.layers[0]?.type).toBe("background");
  });

  it("toda capa con origen referencia una fuente declarada y una capa de origen conocida", () => {
    for (const layer of style.layers) {
      if (!("source" in layer) || !layer.source) continue;
      expect(style.sources[layer.source], layer.id).toBeDefined();
      if (layer.source === SOURCE_ID) {
        expect(USED_SOURCE_LAYERS, layer.id).toContain(layer["source-layer"]);
      } else {
        expect(layer.source, layer.id).toBe(TORRE_SOURCE_ID);
      }
    }
  });

  it("no usa poi, housenumber ni otras capas descartadas", () => {
    const used = new Set(
      style.layers.map((l) => ("source-layer" in l ? l["source-layer"] : undefined)),
    );
    for (const dropped of ["poi", "housenumber", "mountain_peak", "aerodrome_label", "boundary"]) {
      expect(used.has(dropped), dropped).toBe(false);
    }
  });

  it("extruye edificios con render_height y render_min_height", () => {
    const layer = style.layers.find((l) => l.id === "building-3d");
    expect(layer?.type).toBe("fill-extrusion");
    expect(EXTRUSION_HEIGHT).toEqual(["get", "render_height"]);
    expect(EXTRUSION_BASE).toEqual(["get", "render_min_height"]);
    const paint = paintOf("building-3d");
    expect(paint["fill-extrusion-height"]).toEqual(["get", "render_height"]);
    expect(paint["fill-extrusion-base"]).toEqual(["get", "render_min_height"]);
    // En z13 la tesela no trae alturas: la extrusión empieza en z14.
    expect((layer as { minzoom: number }).minzoom).toBe(14);
  });

  it("agua y costa llevan la paleta nocturna aprobada", () => {
    expect(paintOf("background")["background-color"]).toBe("#0a0f19");
    expect(paintOf("water")["fill-color"]).toBe("#0b2236");
    expect(paintOf("coast")["line-color"]).toBe("#1e3a55");
  });

  it("solo toca el propio origen: teselas pmtiles y glifos del mismo dominio, sin sprites", () => {
    const urls: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string" && /^(https?|pmtiles):/.test(value)) urls.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(style);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.replace("pmtiles://", ""), url).toMatch(/^https:\/\/pulso\.test\//);
    }
    expect(style.sprite).toBeUndefined();
  });

  it("todas las etiquetas usan la fuente de glifos alojada", () => {
    const symbols = style.layers.filter((l) => l.type === "symbol");
    expect(symbols.length).toBeGreaterThan(0);
    for (const layer of symbols) {
      const layout = (layer as unknown as { layout: Record<string, unknown> }).layout;
      expect(layout["text-font"], layer.id).toEqual([FONT]);
    }
  });

  it("incluye luz y cielo coherentes con la paleta", () => {
    expect(style.light?.position).toEqual([1.5, expect.any(Number), expect.any(Number)]);
    expect(style.sky?.["sky-color"]).toBe("#05080e");
  });

  it("las transiciones de color se anulan con prefers-reduced-motion", () => {
    const reduced = buildStyle(paletteAt(0), {
      tilesUrl: "pmtiles://x",
      glyphsUrl: "x",
      reducedMotion: true,
    });
    expect(reduced.transition).toEqual({ duration: 0, delay: 0 });
  });
});
