import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import "./attribution.css";
import {
  createIntro,
  createOrbit,
  decideIntro,
  decideOrbit,
  domInterrupts,
  introStart,
  rafScheduler,
  type Camera,
} from "./intro";
import { paletteAt, type MapPalette } from "./palette";
import { buildStyle, lightFor, skyFor } from "./style";

/** Este módulo es el chunk diferido del mapa: MapLibre + pmtiles solo entran por aquí. */

export interface PulsoMapOptions {
  container: HTMLElement;
  /** Reloj (UTC epoch ms). */
  now: () => number;
  /** Tecla `?t=` fijada: no se reevalúa la luz cada minuto. */
  fixedTime?: boolean;
  onFirstFrame?: () => void;
}

export interface PulsoMap {
  map: maplibregl.Map;
  destroy(): void;
}

const TILES_PATH = "tiles/coruna.pmtiles";
const GLYPHS_PATH = "glyphs/";
export const ATTRIBUTION =
  '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
  '<a href="https://www.catastro.hacienda.gob.es/" target="_blank" rel="noopener">© Dirección General del Catastro (Ministerio de Hacienda)</a>';

/** Península de A Coruña: bahía al este y Orzán al oeste, Torre de Hércules al fondo. */
const CAMERA = {
  center: [-8.4065, 43.3755] as [number, number],
  zoom: 14.2,
  zoomNarrow: 14.0,
  pitch: 58,
  bearing: 20,
};
/** bbox de las teselas (infra/tiles/build.sh). */
const BOUNDS: [[number, number], [number, number]] = [
  [-8.58, 43.27],
  [-8.25, 43.52],
];

let protocolRegistered = false;
function registerProtocol(): void {
  if (protocolRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

function applyPalette(map: maplibregl.Map, prev: MapPalette, next: MapPalette): void {
  const style = buildStyle(next, { tilesUrl: "", glyphsUrl: "" });
  const before = buildStyle(prev, { tilesUrl: "", glyphsUrl: "" });
  const prevPaint = new Map(before.layers.map((l) => [l.id, l.paint as Record<string, unknown>]));
  for (const layer of style.layers) {
    const paint = (layer as { paint?: Record<string, unknown> }).paint;
    if (!paint || !map.getLayer(layer.id)) continue;
    const old = prevPaint.get(layer.id) ?? {};
    for (const [key, value] of Object.entries(paint)) {
      if (JSON.stringify(old[key]) !== JSON.stringify(value)) {
        map.setPaintProperty(layer.id, key, value as never);
      }
    }
  }
  map.setLight(lightFor(next));
  map.setSky(skyFor(next));
  setVeil(next);
}

function setVeil(p: MapPalette): void {
  document.documentElement.style.setProperty("--pulso-map-veil", p.bg);
}

export function createPulsoMap(opts: PulsoMapOptions): PulsoMap {
  registerProtocol();
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  const tilesUrl = `pmtiles://${new URL(TILES_PATH, base).href}`;
  const glyphsUrl = `${new URL(GLYPHS_PATH, base).href}{fontstack}/{range}.pbf`;

  let palette = paletteAt(opts.now());
  setVeil(palette);
  const narrow = opts.container.clientWidth < 700;

  // Intro (M2.3): una vez por carga. Con reduced-motion o ?intro=0 (dev) el mapa nace en la cámara final.
  const decision = decideIntro({
    search: window.location.search,
    dev: import.meta.env.DEV,
    reducedMotion: reducedQuery.matches,
  });
  const finalCamera: Camera = {
    center: CAMERA.center,
    zoom: narrow ? CAMERA.zoomNarrow : CAMERA.zoom,
    pitch: CAMERA.pitch,
    bearing: CAMERA.bearing,
  };
  const initial = decision.play ? introStart(finalCamera) : finalCamera;

  const map = new maplibregl.Map({
    container: opts.container,
    style: buildStyle(palette, { tilesUrl, glyphsUrl, reducedMotion: reducedQuery.matches }),
    ...initial,
    maxPitch: 70,
    minZoom: 10.5,
    maxZoom: 17,
    attributionControl: false,
    fadeDuration: reducedQuery.matches ? 0 : 300,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    canvasContextAttributes: { antialias: false, powerPreference: "high-performance" },
  });
  // Deja libre la zona de la hora y el índice: la Torre queda justo debajo.
  map.setPadding(
    narrow
      ? { top: 230, bottom: 60, left: 0, right: 0 }
      : { top: 120, bottom: 40, left: 0, right: 0 },
  );
  map.addControl(
    new maplibregl.AttributionControl({ customAttribution: ATTRIBUTION, compact: false }),
    "bottom-right",
  );

  map.once("load", () => {
    requestAnimationFrame(() => {
      performance.mark("map:first-frame");
      opts.onFirstFrame?.();
      if (!decision.play) {
        performance.mark("map:intro-skipped");
        return;
      }
      const interrupts = domInterrupts();
      createIntro({
        target: map,
        from: initial,
        to: finalCamera,
        scheduler: rafScheduler,
        interrupts,
        mark: (name) => performance.mark(name),
        onDone(how) {
          const orbit = decideOrbit({
            search: window.location.search,
            dev: import.meta.env.DEV,
            reducedMotion: reducedQuery.matches,
          });
          if (how === "end" && orbit) {
            createOrbit({ target: map, from: finalCamera, scheduler: rafScheduler, interrupts });
          }
        },
      }).start();
    });
  });
  // maxBounds se descoloca con la cámara inclinada: se ajusta solo el centro al terminar.
  map.on("moveend", () => {
    const c = map.getCenter();
    const lng = Math.min(BOUNDS[1][0], Math.max(BOUNDS[0][0], c.lng));
    const lat = Math.min(BOUNDS[1][1], Math.max(BOUNDS[0][1], c.lat));
    if (lng !== c.lng || lat !== c.lat) map.easeTo({ center: [lng, lat], duration: 400 });
  });
  map.on("error", (e) => console.error("[map]", e.error?.message ?? e));

  if (import.meta.env.DEV) (window as unknown as { __pulsoMap?: maplibregl.Map }).__pulsoMap = map;

  let timer: ReturnType<typeof setInterval> | undefined;
  if (!opts.fixedTime) {
    timer = setInterval(() => {
      const next = paletteAt(opts.now());
      if (!map.isStyleLoaded()) return;
      applyPalette(map, palette, next);
      palette = next;
    }, 60_000);
  }

  return {
    map,
    destroy() {
      if (timer) clearInterval(timer);
      map.remove();
    },
  };
}
