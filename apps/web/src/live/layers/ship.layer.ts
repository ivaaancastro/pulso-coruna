import { TripsLayer } from "@deck.gl/geo-layers";
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Entity, LayerItem } from "@pulso/schema";
import { createTranslator, detectLocale, type Locale, type Translate } from "../../i18n";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import { EMPTY_TRAILS, TrailHistory } from "./bus/trails";
import { formatShipCard } from "./ship/card";
import { lazyCardView } from "../card/panel";
import { shipInfo } from "./ship/meta";
import { ageOf, FOCUS_RGB, SELECT_RADIUS, SHIP_RGB, STALE_MS, styleShips } from "./ship/model";
import { shipTrailConfig } from "./ship/trail";

/**
 * Capa de barcos (AIS): siluetas orientadas al rumbo, tamaño por tipo, parados discretos, estela
 * corta en los que navegan, desvanecimiento de los que callan y tarjeta al tocar. Posición y
 * rumbo salen del worker ya interpolados (`store.frame("ship")`); el resto, de `store.items`.
 */

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

/** Proporción del casco: la silueta mide 32×64 en el atlas. */
const ATLAS = { w: 32, h: 64 } as const;

const history = new TrailHistory();
let selectedId: string | null = null;
let translate: Translate | null = null;
let locale: Locale = "es"; // el de `i18n()`
let atlas: string | null | undefined;
let lastReduced = false;
let announcedId: string | null = null;
let invalidate: (() => void) | null = null;

/** Casco con proa en punta mirando al norte, en máscara (se tiñe con el color de la capa). */
function iconAtlas(): string | null {
  if (atlas !== undefined) return atlas;
  atlas = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS.w;
    canvas.height = ATLAS.h;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(16, 2);
      g.lineTo(28, 22);
      g.lineTo(28, 62);
      g.lineTo(4, 62);
      g.lineTo(4, 22);
      g.closePath();
      g.fill();
      atlas = canvas.toDataURL("image/png");
    }
  } catch {
    atlas = null;
  }
  return atlas;
}

/** Idioma y traductor, en caché mientras no cambie `?lang=`. */
function i18n(): { t: Translate; locale: Locale } {
  const next = detectLocale(window.location.search, navigator.languages);
  if (!translate || next !== locale) {
    locale = next;
    translate = createTranslator(next);
  }
  return { t: translate, locale };
}

const getCard = lazyCardView("ship", {
  t: (key, params) => i18n().t(key, params),
  onClose: () => select(null),
});

function select(id: string | null): void {
  const changed = selectedId !== id;
  selectedId = id;
  if (id === null) {
    getCard().hide();
    announcedId = null;
  }
  if (changed) invalidate?.();
}

function asShip(item: LayerItem | undefined): Entity | undefined {
  return item && "layer" in item && item.layer === "ship" ? (item as Entity) : undefined;
}

/** Cierra o refresca la tarjeta con el dato más reciente del barco seleccionado. */
function syncCard(ctx: LiveLayerContext): void {
  if (selectedId === null) return;
  const entity = asShip(ctx.store.items("ship").get(selectedId));
  if (!entity || ageOf(entity.ts, ctx.now) >= STALE_MS) {
    select(null); // el barco salió del almacén o lleva demasiado callado
    return;
  }
  const { t, locale: lang } = i18n();
  const announce = announcedId !== selectedId;
  announcedId = selectedId;
  getCard().show(formatShipCard(shipInfo(entity), t, lang, ctx.now), announce);
}

function createShipLayers(ctx: LiveLayerContext) {
  invalidate = ctx.invalidate;
  const frame = ctx.store.frame("ship");
  if (!frame || frame.count === 0) {
    history.clear();
    if (selectedId !== null) select(null);
    return [];
  }
  syncCard(ctx);

  const items = ctx.store.items("ship");
  const style = styleShips(frame, (id) => asShip(items.get(id)), ctx.now);
  const settings = shipTrailConfig.settings;
  const trailsOn = !ctx.reducedMotion && settings.lengthMs > 0;
  if (trailsOn) {
    history.record(ctx.now, frame.ids, frame.positions, frame.count, settings);
  } else if (history.size > 0 || lastReduced !== ctx.reducedMotion) {
    history.clear();
  }
  lastReduced = ctx.reducedMotion;
  const trails = trailsOn
    ? history.build(
        ctx.now,
        frame.ids,
        frame.positions,
        frame.count,
        settings.lengthMs,
        () => SHIP_RGB,
        (i) => style.trail[i] === 1,
      )
    : EMPTY_TRAILS;

  const fresh = ctx.store.freshness("ship")?.receivedAt ?? 0;
  const position = { value: frame.positions, size: 2 };
  const ids = frame.ids;
  const onPick = (info: { index: number }): boolean => {
    const id = info.index >= 0 ? ids[info.index] : undefined;
    if (id !== undefined) select(id === selectedId ? null : id);
    return id !== undefined;
  };

  const layers = [];
  layers.push(
    new TripsLayer({
      id: "ship-trails",
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
      getWidth: 2,
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: ADDITIVE,
    }),
  );

  const url = iconAtlas();
  // Los atributos cambian con el tiempo (desvanecimiento): se refrescan en cada fotograma.
  const triggers = [frame.idsVersion, fresh, ctx.now];
  if (url) {
    layers.push(
      new IconLayer({
        id: "ship-icons",
        data: {
          length: frame.count,
          attributes: {
            getPosition: position,
            getAngle: { value: style.angles, size: 1 },
            getColor: { value: style.colors, size: 4 },
            getSize: { value: style.sizes, size: 1 },
          },
        },
        iconAtlas: url,
        iconMapping: { hull: { x: 0, y: 0, width: ATLAS.w, height: ATLAS.h, mask: true } },
        getIcon: () => "hull",
        billboard: false,
        sizeUnits: "pixels",
        pickable: false,
        updateTriggers: { getColor: triggers, getSize: triggers, getAngle: triggers },
      }),
    );
  } else {
    layers.push(
      new ScatterplotLayer({
        id: "ship-icons",
        data: {
          length: frame.count,
          attributes: {
            getPosition: position,
            getFillColor: { value: style.colors, size: 4 },
            getRadius: { value: style.sizes, size: 1 },
          },
        },
        radiusUnits: "pixels",
        radiusScale: 0.25,
        billboard: true,
        pickable: false,
        updateTriggers: { getFillColor: triggers, getRadius: triggers },
      }),
    );
  }

  const selected = selectedId === null ? -1 : frame.ids.indexOf(selectedId);
  if (selected >= 0 && style.hits[selected] !== 0) {
    layers.push(
      new ScatterplotLayer({
        id: "ship-selected",
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
        getRadius: SELECT_RADIUS,
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        getLineColor: [...FOCUS_RGB, 255],
        pickable: false,
      }),
    );
  }

  // Zona de toque de 44 px por barco, casi transparente (0 = barco vencido, no se toca).
  layers.push(
    new ScatterplotLayer({
      id: "ship-hit",
      data: {
        length: frame.count,
        attributes: { getPosition: position, getRadius: { value: style.hits, size: 1 } },
      },
      radiusUnits: "pixels",
      billboard: true,
      filled: true,
      getFillColor: [0, 0, 0, 1],
      pickable: true,
      onClick: onPick,
      updateTriggers: { getRadius: triggers },
    }),
  );
  return layers;
}

const ship: LiveLayerDefinition = {
  id: "ship",
  sources: ["ship"],
  // Las estelas y el desvanecimiento avanzan con el reloj.
  animated: true,
  // Sin dato (M4.6): cierra la tarjeta abierta (el pipeline ya hace la capa no seleccionable).
  onSourceState(state) {
    if (state === "nodata" && selectedId !== null) select(null);
  },
  createLayers: createShipLayers,
  // M4.7: alto/medio/bajo → estela de 90 s / 45 s / sin estela.
  setQualityLevel: (level) => shipTrailConfig.setQuality(level),
};

export default ship;
