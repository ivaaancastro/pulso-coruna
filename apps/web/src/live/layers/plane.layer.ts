import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import {
  createTranslator,
  detectLocale,
  INTL_LOCALE,
  type Locale,
  type Translate,
} from "../../i18n";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import { formatPlaneCard } from "../plane/card";
import { createPlaneCard, type PlaneCardView } from "../plane/card-view";
import { estimate, type PlaneEstimate } from "../plane/extrapolate";
import { FixHistory, trailSegments, type TrailSegment } from "../plane/history";
import { isPlane, planeInfo, type PlaneInfo } from "../plane/meta";
import {
  FOCUS_RGB,
  HIT_RADIUS,
  PLANE_RGB,
  SELECT_RADIUS,
  iconAlpha,
  iconSize,
} from "../plane/style";

/**
 * Capa de aviones (OpenSky, una posición cada ~5 min): silueta orientada con traza corta y la
 * posición extrapolada con rumbo y velocidad entre actualizaciones (`plane/extrapolate.ts`, tope
 * 8 min, luego se desvanece). Lee las `Entity` crudas del almacén y calcula la pose con el reloj de la
 * app en cada fotograma: el interpolador del worker no extrapola, y con 5 min entre datos solo
 * «saltaría». Ver docs/specs/M5.2d-capa-aviones.md.
 */

/** Con reduced-motion la posición estimada se actualiza a saltos de este tamaño, ms. */
export const REDUCED_STEP_MS = 15_000;

interface Shown {
  info: PlaneInfo;
  est: PlaneEstimate;
  position: [number, number];
}

const history = new FixHistory();
let selectedId: string | null = null;
let card: PlaneCardView | null = null;
let translate: Translate | null = null;
let locale: Locale | null = null;
let atlas: string | null | undefined;
let announcedId: string | null = null;
let invalidate: (() => void) | null = null;
/** ¿Hay aviones dibujables? Mientras no los haya la capa no pide fotogramas. */
let active = false;

/** Silueta de avión mirando al norte, en máscara (se tiñe con el color de la capa). */
function iconAtlas(): string | null {
  if (atlas !== undefined) return atlas;
  atlas = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext("2d");
    if (g) {
      // Lado derecho, de la nariz a la cola; el izquierdo es su espejo.
      const right: [number, number][] = [
        [32, 3],
        [35, 10],
        [35.5, 25],
        [60, 40],
        [60, 45],
        [35.5, 38],
        [35, 50],
        [44, 57],
        [44, 61],
        [32, 57.5],
      ];
      g.fillStyle = "#fff";
      g.beginPath();
      right.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      for (let i = right.length - 2; i >= 1; i--) {
        const [x, y] = right[i] as [number, number];
        g.lineTo(64 - x, y);
      }
      g.closePath();
      g.fill();
      atlas = canvas.toDataURL("image/png");
    }
  } catch {
    atlas = null;
  }
  return atlas;
}

function getCard(): PlaneCardView | null {
  if (card) return card;
  const host = document.getElementById("app") ?? document.body;
  locale ??= detectLocale(window.location.search, navigator.languages);
  translate ??= createTranslator(locale);
  card = createPlaneCard({ t: translate, host, onClose: () => select(null) });
  return card;
}

function select(id: string | null): void {
  const changed = selectedId !== id;
  selectedId = id;
  if (id === null) {
    card?.hide();
    announcedId = null;
  }
  if (changed) invalidate?.();
}

function syncCard(at: number, shown: readonly Shown[]): void {
  if (selectedId === null) return;
  const item = shown.find((s) => s.info.id === selectedId);
  if (!item) {
    select(null); // el avión salió o ya es demasiado viejo para mostrarse
    return;
  }
  const view = getCard();
  if (!view || !translate || !locale) return;
  const announce = announcedId !== selectedId;
  announcedId = selectedId;
  view.show(formatPlaneCard(item.info, item.est, at, translate, INTL_LOCALE[locale]), announce);
}

function shownPlanes(ctx: LiveLayerContext, at: number): Shown[] {
  const out: Shown[] = [];
  for (const item of ctx.store.items("plane").values()) {
    if (!isPlane(item)) continue;
    const info = planeInfo(item);
    const est = estimate(info, at);
    if (est.opacity <= 0) continue; // dato demasiado viejo: no se dibuja
    out.push({ info, est, position: [est.lon, est.lat] });
  }
  return out;
}

function createPlaneLayers(ctx: LiveLayerContext): Layer[] {
  invalidate = ctx.invalidate;
  // Con reduced-motion, sin deslizamiento: la estimación avanza a saltos.
  const at = ctx.reducedMotion ? Math.floor(ctx.now / REDUCED_STEP_MS) * REDUCED_STEP_MS : ctx.now;
  const planes = shownPlanes(ctx, at);
  active = planes.length > 0;
  if (!active) {
    history.clear();
    if (selectedId !== null) select(null);
    return [];
  }
  history.record(
    planes.map((p) => p.info),
    at,
  );
  syncCard(at, planes);

  const segments: TrailSegment[] = [];
  for (const p of planes) {
    if (p.info.onGround) continue; // en tierra: discreto, sin traza
    segments.push(...trailSegments(history.get(p.info.id), p.position, p.est.opacity));
  }

  const onPick = (info: { object?: Shown | null }): boolean => {
    const id = info.object?.info.id;
    if (id === undefined) return false;
    select(id === selectedId ? null : id);
    return true;
  };

  const layers: Layer[] = [];
  layers.push(
    new PathLayer<TrailSegment>({
      id: "plane-trail",
      data: segments,
      getPath: (s) => s.path,
      getColor: (s) => [...PLANE_RGB, Math.round(255 * s.alpha)],
      getWidth: 1.5,
      widthUnits: "pixels",
      capRounded: true,
      pickable: false,
    }),
  );

  const url = iconAtlas();
  if (url) {
    layers.push(
      new IconLayer<Shown>({
        id: "plane-icons",
        data: planes,
        getPosition: (p) => p.position,
        getAngle: (p) => -(p.info.heading ?? 0), // deck.gl gira en sentido antihorario
        getSize: (p) => iconSize(p.info.altM, p.info.onGround),
        getColor: (p) => [...PLANE_RGB, iconAlpha(p.info.onGround, p.est.opacity)],
        iconAtlas: url,
        iconMapping: { plane: { x: 0, y: 0, width: 64, height: 64, mask: true } },
        getIcon: () => "plane",
        billboard: false,
        sizeUnits: "pixels",
        pickable: false,
      }),
    );
  } else {
    layers.push(
      new ScatterplotLayer<Shown>({
        id: "plane-icons",
        data: planes,
        getPosition: (p) => p.position,
        getRadius: (p) => iconSize(p.info.altM, p.info.onGround) / 4,
        getFillColor: (p) => [...PLANE_RGB, iconAlpha(p.info.onGround, p.est.opacity)],
        radiusUnits: "pixels",
        billboard: true,
        pickable: false,
      }),
    );
  }

  const selected = planes.find((p) => p.info.id === selectedId);
  if (selected) {
    layers.push(
      new ScatterplotLayer<Shown>({
        id: "plane-selected",
        data: [selected],
        getPosition: (p) => p.position,
        getRadius: SELECT_RADIUS,
        stroked: true,
        filled: false,
        getLineWidth: 2,
        getLineColor: [...FOCUS_RGB, 255],
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        billboard: true,
        pickable: false,
      }),
    );
  }

  // Zona de toque de 44 px, casi transparente.
  layers.push(
    new ScatterplotLayer<Shown>({
      id: "plane-hit",
      data: planes,
      getPosition: (p) => p.position,
      getRadius: HIT_RADIUS,
      getFillColor: [0, 0, 0, 1],
      radiusUnits: "pixels",
      billboard: true,
      pickable: true,
      onClick: onPick,
    }),
  );
  return layers;
}

const plane: LiveLayerDefinition = {
  id: "plane",
  sources: ["plane"],
  // Se mueve con el reloj (extrapolación) mientras haya aviones; vacía, no gasta fotogramas.
  get animated() {
    return active;
  },
  // Sin dato (M4.6): cierra la tarjeta abierta (el pipeline ya hace la capa no seleccionable).
  onSourceState(state) {
    if (state === "nodata" && selectedId !== null) select(null);
  },
  createLayers: createPlaneLayers,
};

export default plane;
