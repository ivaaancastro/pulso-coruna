import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapPalette } from "./palette";

/**
 * Estilo propio «Faro» sobre las teselas OpenMapTiles de infra/tiles (ADR-0009).
 * Solo origen propio: teselas `pmtiles://` y glifos del mismo dominio; sin sprites (no hay iconos).
 * Se omiten `poi`, `housenumber`, `mountain_peak`, `aerodrome_label`, `aeroway` y `boundary`.
 */
export const SOURCE_ID = "omt";
export const TORRE_SOURCE_ID = "torre";
export const FONT = "Archivo Regular";

/** Capas del esquema OpenMapTiles que el estilo puede referenciar (las demás se ignoran). */
export const USED_SOURCE_LAYERS = [
  "landcover",
  "landuse",
  "park",
  "water",
  "waterway",
  "transportation",
  "building",
  "place",
  "water_name",
  "transportation_name",
] as const;

/** Torre de Hércules: [lon, lat]. */
export const TORRE_LNGLAT: [number, number] = [-8.4064, 43.3862];

export interface StyleOptions {
  /** URL absoluta de las teselas (`pmtiles://https://…/coruna.pmtiles`). */
  tilesUrl: string;
  /** Plantilla absoluta de glifos (`https://…/glyphs/{fontstack}/{range}.pbf`). */
  glyphsUrl: string;
  /** Sin transiciones de color (prefers-reduced-motion). */
  reducedMotion?: boolean;
}

const zoomWidth = (...stops: number[]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.4], ["zoom"], ...stops] as unknown as ExpressionSpecification;

const ROAD_CLASSES_MAJOR = ["motorway", "trunk", "primary"];
const ROAD_CLASSES_MID = ["secondary", "tertiary"];
const ROAD_CLASSES_MINOR = ["minor", "service"];
const NAMED_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];

const notTunnel: ExpressionSpecification = ["!=", ["get", "brunnel"], "tunnel"];
const isLine: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];

/** Altura extruida: la que trae la tesela. Se cierra aquí porque el contrato lo fija el test. */
export const EXTRUSION_HEIGHT: ExpressionSpecification = ["get", "render_height"];
export const EXTRUSION_BASE: ExpressionSpecification = ["get", "render_min_height"];

export function buildLayers(p: MapPalette): LayerSpecification[] {
  const textFont = [FONT];
  const halo = { "text-halo-color": p.bg, "text-halo-width": 1.5, "text-halo-blur": 0.5 };

  return [
    { id: "background", type: "background", paint: { "background-color": p.land } },
    {
      id: "landcover",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland"]]],
      paint: { "fill-color": p.landSoft },
    },
    {
      id: "park",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "park",
      paint: { "fill-color": p.landSoft },
    },
    {
      // Agua: la masa dominante, azul tinta más clara que la tierra. La profundidad la da la
      // niebla del cielo (se funde con `bg` hacia el horizonte).
      id: "water",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "water",
      paint: { "fill-color": p.water },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "waterway",
      minzoom: 12,
      paint: { "line-color": p.water, "line-width": zoomWidth(12, 0.5, 16, 2) },
    },
    {
      // Resplandor corto de la orilla. Estrecho a propósito: las líneas anchas sobre polígonos
      // de agua dejan costuras visibles en los bordes de tesela.
      id: "coast-glow",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "water",
      layout: { "line-join": "round" },
      paint: {
        "line-color": p.shore,
        "line-width": zoomWidth(10, 2.5, 14, 5, 17, 9),
        "line-blur": zoomWidth(10, 2, 14, 4, 17, 7),
        "line-opacity": 0.6,
      },
    },
    {
      // La costa es la figura de la postal: trazo nítido y continuo.
      id: "coast",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "water",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": p.coast, "line-width": zoomWidth(10, 0.8, 14, 1.4, 17, 2.4) },
    },
    {
      id: "road-minor",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "transportation",
      minzoom: 13,
      filter: ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", ROAD_CLASSES_MINOR]]],
      layout: { "line-join": "round" },
      paint: { "line-color": p.road, "line-width": zoomWidth(13, 0.4, 17, 2.2) },
    },
    {
      id: "road-mid",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", ROAD_CLASSES_MID]]],
      layout: { "line-join": "round" },
      paint: { "line-color": p.roadMajor, "line-width": zoomWidth(11, 0.4, 17, 3.2) },
    },
    {
      id: "road-major",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "transportation",
      minzoom: 9,
      filter: ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", ROAD_CLASSES_MAJOR]]],
      layout: { "line-join": "round" },
      paint: { "line-color": p.roadMajor, "line-width": zoomWidth(9, 0.6, 17, 4.6) },
    },
    {
      // z13: la tesela trae huellas sin atributos de altura; se pintan planas hasta z14.
      id: "building-flat",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "building",
      minzoom: 13,
      maxzoom: 14,
      paint: { "fill-color": p.building, "fill-opacity": 0.9 },
    },
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: SOURCE_ID,
      "source-layer": "building",
      minzoom: 14,
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        "fill-extrusion-height": EXTRUSION_HEIGHT,
        "fill-extrusion-base": EXTRUSION_BASE,
        // Más altos, algo más claros: profundidad sin añadir un solo píxel de brillo.
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["get", "render_height"],
          6,
          p.building,
          60,
          p.buildingTall,
        ],
        "fill-extrusion-opacity": 0.94,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "water-name",
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": "water_name",
      minzoom: 9,
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": textFont,
        "text-size": zoomWidth(9, 12, 15, 15),
        "text-letter-spacing": 0.3,
        "text-max-width": 8,
        "text-padding": 20,
      },
      paint: { "text-color": p.waterLabel, ...halo },
    },
    {
      id: "road-name",
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["in", ["get", "class"], ["literal", NAMED_ROAD_CLASSES]],
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": textFont,
        "text-size": zoomWidth(14, 12, 17, 13),
        "text-letter-spacing": 0.08,
        "text-padding": 12,
      },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "place-minor",
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": "place",
      minzoom: 12,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["suburb", "neighbourhood", "quarter", "village", "hamlet"]],
      ],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": textFont,
        "text-size": zoomWidth(12, 12, 16, 14),
        "text-letter-spacing": 0.12,
        "text-max-width": 7,
      },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "place-major",
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": textFont,
        "text-size": zoomWidth(8, 13, 14, 20),
        "text-letter-spacing": 0.14,
        "text-max-width": 8,
      },
      paint: { "text-color": p.labelStrong, ...halo },
    },
    {
      // Firma de la postal: la luz fija de la Torre de Hércules (el haz animado llega con M2.3).
      id: "torre-halo",
      type: "circle",
      source: TORRE_SOURCE_ID,
      paint: {
        "circle-radius": zoomWidth(10, 10, 15, 26),
        "circle-color": "#f5f1e4",
        "circle-opacity": 0.14,
        "circle-blur": 1,
      },
    },
    {
      id: "torre-luz",
      type: "circle",
      source: TORRE_SOURCE_ID,
      paint: {
        "circle-radius": zoomWidth(10, 2, 15, 3.5),
        "circle-color": "#f5f1e4",
        "circle-opacity": 0.95,
      },
    },
  ];
}

export function buildStyle(p: MapPalette, o: StyleOptions): StyleSpecification {
  return {
    version: 8,
    name: "Pulso Faro",
    glyphs: o.glyphsUrl,
    transition: o.reducedMotion ? { duration: 0, delay: 0 } : { duration: 800, delay: 0 },
    light: lightFor(p),
    sky: skyFor(p),
    sources: {
      [SOURCE_ID]: { type: "vector", url: o.tilesUrl },
      [TORRE_SOURCE_ID]: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: "Torre de Hércules" },
          geometry: { type: "Point", coordinates: TORRE_LNGLAT },
        },
      },
    },
    layers: buildLayers(p),
  };
}

export function lightFor(p: MapPalette): NonNullable<StyleSpecification["light"]> {
  return {
    anchor: "map",
    position: [1.5, p.light.azimuth, p.light.polar],
    color: p.light.color,
    intensity: p.light.intensity,
  };
}

export function skyFor(p: MapPalette): NonNullable<StyleSpecification["sky"]> {
  return {
    "sky-color": p.bg,
    "horizon-color": p.bg,
    "fog-color": p.bg,
    "fog-ground-blend": 0.9,
    "horizon-fog-blend": 0.7,
    "sky-horizon-blend": 0.6,
  };
}
