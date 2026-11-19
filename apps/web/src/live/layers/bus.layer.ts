import { TripsLayer } from "@deck.gl/geo-layers";
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Entity, LayerItem } from "@pulso/schema";
import { createTranslator, detectLocale, type Translate } from "../../i18n";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import type { LiveFrame } from "../live-store";
import { formatBusCard } from "./bus/card";
import { createBusCard, type BusCardView } from "./bus/card-view";
import { colorForLine, FOCUS_COLOR, type Rgb } from "./bus/line-color";
import { BUS_META, busInfo } from "./bus/meta";
import { busTrailConfig } from "./bus/trail-config";
import { EMPTY_TRAILS, TrailHistory } from "./bus/trails";

/**
 * Capa bus: puntos orientados por rumbo con estela por línea («cometas»), toque para ver la
 * tarjeta. Los datos salen del worker ya interpolados (`store.frame("bus")`); la estela se
 * construye con las posiciones de los últimos segundos (`bus/trails.ts`). Funciona igual con
 * posiciones reales y con estimadas por horario (`meta.estimated`, ver `bus/meta.ts`).
 */

const HALO_ALPHA = 18;
/** Por encima, sin halo (direccion.md: ≤ 2000 instancias). */
const HALO_MAX = 2000;
const ICON_PX = 20;
const HALO_PX = 22;

/** Mezcla aditiva: donde se cruzan estelas se acumula luz (direccion.md, «brillo barato»). */
const ADDITIVE = {
  depthCompare: "always",
  depthWriteEnabled: false,
  blend: true,
  blendColorOperation: "add",
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaOperation: "add",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
} as const;

const history = new TrailHistory();
let selectedId: string | null = null;
let card: BusCardView | null = null;
let translate: Translate | null = null;
let atlas: string | null | undefined;
let lastReduced = false;
let announcedId: string | null = null;
let invalidate: (() => void) | null = null;

/** Flecha apuntando al norte, en máscara (se tiñe con el color de la línea). */
function iconAtlas(): string | null {
  if (atlas !== undefined) return atlas;
  atlas = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(32, 4);
      g.lineTo(55, 58);
      g.lineTo(32, 45);
      g.lineTo(9, 58);
      g.closePath();
      g.fill();
      atlas = canvas.toDataURL("image/png");
    }
  } catch {
    atlas = null;
  }
  return atlas;
}

function getCard(): BusCardView | null {
  if (card) return card;
  const host = document.getElementById("app") ?? document.body;
  translate ??= createTranslator(detectLocale(window.location.search, navigator.languages));
  card = createBusCard({ t: translate, host, onClose: () => select(null) });
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

function asBus(item: LayerItem | undefined): Entity | undefined {
  return item && "layer" in item && item.layer === "bus" ? (item as Entity) : undefined;
}

function entityOf(ctx: LiveLayerContext, id: string): Entity | undefined {
  return asBus(ctx.store.items("bus").get(id));
}

/** Cierra o refresca la tarjeta con el dato más reciente del bus seleccionado. */
function syncCard(ctx: LiveLayerContext): void {
  if (selectedId === null) return;
  const entity = entityOf(ctx, selectedId);
  if (!entity) {
    select(null); // el bus salió de servicio
    return;
  }
  const view = getCard();
  if (!view || !translate) return;
  const announce = announcedId !== selectedId;
  announcedId = selectedId;
  const info = busInfo(entity);
  view.show(formatBusCard(info, translate), colorForLine(info.line), announce);
}

const colorCache = new Map<string, Rgb>();
function lineColor(line: unknown): Rgb {
  const key = typeof line === "string" || typeof line === "number" ? String(line) : "";
  let c = colorCache.get(key);
  if (!c) {
    c = colorForLine(key === "" ? undefined : key);
    colorCache.set(key, c);
  }
  return c;
}

interface Attrs {
  colors: Uint8Array;
  halo: Uint8Array;
  angles: Float32Array;
}

function attributes(ctx: LiveLayerContext, frame: LiveFrame): Attrs {
  const items = ctx.store.items("bus");
  const n = frame.count;
  const colors = new Uint8Array(n * 4);
  const halo = new Uint8Array(n * 4);
  const angles = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = lineColor(asBus(items.get(frame.ids[i] as string))?.meta?.[BUS_META.line]);
    colors[4 * i] = r;
    colors[4 * i + 1] = g;
    colors[4 * i + 2] = b;
    colors[4 * i + 3] = 255;
    halo[4 * i] = r;
    halo[4 * i + 1] = g;
    halo[4 * i + 2] = b;
    halo[4 * i + 3] = HALO_ALPHA;
    angles[i] = -(frame.headings[i] as number); // deck.gl gira en sentido antihorario
  }
  return { colors, halo, angles };
}

function createBusLayers(ctx: LiveLayerContext) {
  invalidate = ctx.invalidate;
  const frame = ctx.store.frame("bus");
  if (!frame || frame.count === 0) {
    history.clear();
    if (selectedId !== null) select(null);
    return [];
  }
  syncCard(ctx);

  const attrs = attributes(ctx, frame);
  const settings = busTrailConfig.settings;
  const trailsOn = !ctx.reducedMotion && settings.lengthMs > 0;
  if (trailsOn) {
    history.record(ctx.now, frame.ids, frame.positions, frame.count, settings);
  } else if (history.size > 0 || lastReduced !== ctx.reducedMotion) {
    history.clear();
  }
  lastReduced = ctx.reducedMotion;
  const trails = trailsOn
    ? history.build(ctx.now, frame.ids, frame.positions, frame.count, settings.lengthMs, (i) =>
        lineColor(entityOf(ctx, frame.ids[i] as string)?.meta?.[BUS_META.line]),
      )
    : EMPTY_TRAILS;

  const fresh = ctx.store.freshness("bus")?.receivedAt ?? 0;
  const position = { value: frame.positions, size: 2 };
  const ids = frame.ids;
  const onPick = (info: { index: number }): boolean => {
    const id = info.index >= 0 ? ids[info.index] : undefined;
    if (id !== undefined) select(id);
    return id !== undefined;
  };

  const layers = [];
  layers.push(
    new TripsLayer({
      id: "bus-trails",
      data: {
        length: trails.length,
        startIndices: trails.startIndices,
        attributes: {
          getPath: { value: trails.positions, size: 2 },
          getTimestamps: { value: trails.timestamps, size: 1 },
          getColor: { value: trails.colors, size: 4 },
        },
      },
      _pathType: "open",
      positionFormat: "XY",
      currentTime: 1,
      trailLength: settings.lengthMs + 1,
      widthUnits: "pixels",
      getWidth: 3,
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: ADDITIVE,
    }),
  );

  if (frame.count <= HALO_MAX) {
    layers.push(
      new ScatterplotLayer({
        id: "bus-halo",
        data: {
          length: frame.count,
          attributes: {
            getPosition: position,
            getFillColor: { value: attrs.halo, size: 4 },
          },
        },
        radiusUnits: "pixels",
        billboard: true,
        getRadius: HALO_PX,
        pickable: true,
        onClick: onPick,
        updateTriggers: { getFillColor: [frame.idsVersion, fresh] },
        parameters: ADDITIVE,
      }),
    );
  }

  const url = iconAtlas();
  if (url) {
    layers.push(
      new IconLayer({
        id: "bus-icons",
        data: {
          length: frame.count,
          attributes: {
            getPosition: position,
            getAngle: { value: attrs.angles, size: 1 },
            getColor: { value: attrs.colors, size: 4 },
          },
        },
        iconAtlas: url,
        iconMapping: { arrow: { x: 0, y: 0, width: 64, height: 64, mask: true } },
        getIcon: () => "arrow",
        billboard: false,
        sizeUnits: "pixels",
        getSize: ICON_PX,
        pickable: frame.count > HALO_MAX,
        onClick: onPick,
        updateTriggers: { getColor: [frame.idsVersion, fresh] },
      }),
    );
  } else {
    layers.push(
      new ScatterplotLayer({
        id: "bus-icons",
        data: {
          length: frame.count,
          attributes: { getPosition: position, getFillColor: { value: attrs.colors, size: 4 } },
        },
        radiusUnits: "pixels",
        getRadius: ICON_PX / 4,
        updateTriggers: { getFillColor: [frame.idsVersion, fresh] },
      }),
    );
  }

  const selected = selectedId === null ? -1 : frame.ids.indexOf(selectedId);
  if (selected >= 0) {
    layers.push(
      new ScatterplotLayer({
        id: "bus-selected",
        data: {
          length: 1,
          attributes: {
            getPosition: {
              value: new Float32Array([
                frame.positions[2 * selected] as number,
                frame.positions[2 * selected + 1] as number,
              ]),
              size: 2,
            },
          },
        },
        stroked: true,
        filled: false,
        billboard: true,
        radiusUnits: "pixels",
        getRadius: HALO_PX - 4,
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        getLineColor: [...FOCUS_COLOR, 255],
        pickable: false,
      }),
    );
  }
  return layers;
}

const bus: LiveLayerDefinition = {
  id: "bus",
  sources: ["bus"],
  // Las estelas avanzan con el reloj: un fotograma tras otro (con reduced-motion, solo con datos).
  animated: true,
  // Sin dato (M4.6): cierra la tarjeta abierta (el pipeline ya hace la capa no seleccionable).
  onSourceState(state) {
    if (state === "nodata" && selectedId !== null) select(null);
  },
  createLayers: createBusLayers,
};

export default bus;
