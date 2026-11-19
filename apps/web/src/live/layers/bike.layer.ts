import { ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { createTranslator, detectLocale } from "../../i18n";
import { createNow } from "../../time/now";
import type { LiveLayerContext, LiveLayerDefinition } from "../layer-registry";
import { createBikeCard, type BikeCard } from "./bike-card";
import {
  BIKE_RGB,
  FOCUS_RGB,
  HIT_RADIUS,
  RING_RADIUS,
  SELECT_RADIUS,
  isStation,
  ringData,
  transitionFor,
  withAlpha,
  type RingDatum,
} from "./bike-model";

/**
 * BiciCoruña: un anillo por estación (docs/design/direccion.md). El relleno es un disco de área
 * proporcional a bikes/(bikes+docks); vacía = aro fino y hueco, llena = aro grueso y disco completo,
 * 0/0 = atenuada. Tocar una estación abre una tarjeta con sus datos.
 */
let selectedId: string | null = null;
let latest: LiveLayerContext | null = null;
let card: BikeCard | null = null;

function ensureCard(): BikeCard {
  if (card) return card;
  const search = window.location.search;
  const locale = detectLocale(search, navigator.languages);
  card = createBikeCard({
    parent: document.getElementById("app") ?? document.body,
    t: createTranslator(locale),
    locale,
    now: createNow(search),
    read: (id) => {
      const item = latest?.store.items("bike").get(id);
      return item && isStation(item) ? item : undefined;
    },
    onClose: () => select(null),
  });
  return card;
}

function select(id: string | null): void {
  selectedId = id;
  if (id !== null) ensureCard().show(id);
  else card?.hide();
  latest?.invalidate();
}

function onPick(info: PickingInfo<RingDatum>): boolean {
  const id = info.object?.id;
  if (id === undefined) return false;
  select(id === selectedId ? null : id);
  return true;
}

const bike: LiveLayerDefinition = {
  id: "bike",
  sources: ["bike"],
  createLayers(ctx) {
    latest = ctx;
    const data = ringData(ctx.store.items("bike").values(), selectedId);
    const transition = transitionFor(ctx.reducedMotion);
    // `billboard`: círculos de cara a la pantalla aunque el mapa esté inclinado (no elipses sobre el suelo).
    const common = { radiusUnits: "pixels", lineWidthUnits: "pixels", billboard: true } as const;
    const color = (d: RingDatum) => withAlpha(BIKE_RGB, d.alpha / 255);

    return [
      // Aro: grosor = estado (fino vacía, grueso llena); no depende solo del color.
      new ScatterplotLayer<RingDatum>({
        ...common,
        id: "bike-ring",
        data,
        getPosition: (d) => d.position,
        getRadius: RING_RADIUS,
        stroked: true,
        filled: false,
        getLineWidth: (d) => d.width,
        getLineColor: color,
        transitions: transition && {
          getLineWidth: transition,
          getLineColor: transition,
        },
      }),
      // Relleno: área ∝ nivel; es lo que «respira» al cambiar la disponibilidad.
      new ScatterplotLayer<RingDatum>({
        ...common,
        id: "bike-fill",
        data,
        getPosition: (d) => d.position,
        getRadius: (d) => d.fillRadius,
        stroked: false,
        filled: true,
        getFillColor: color,
        transitions: transition && { getRadius: transition, getFillColor: transition },
      }),
      // Selección: aro exterior con el color de foco.
      new ScatterplotLayer<RingDatum>({
        ...common,
        id: "bike-selected",
        data: data.filter((d) => d.selected),
        getPosition: (d) => d.position,
        getRadius: SELECT_RADIUS,
        stroked: true,
        filled: false,
        getLineWidth: 2,
        getLineColor: withAlpha(FOCUS_RGB, 1),
      }),
      // Zona de toque de 44 px, casi transparente.
      new ScatterplotLayer<RingDatum>({
        ...common,
        id: "bike-hit",
        data,
        getPosition: (d) => d.position,
        getRadius: HIT_RADIUS,
        stroked: false,
        filled: true,
        getFillColor: [0, 0, 0, 1],
        pickable: true,
        onClick: onPick,
      }),
    ];
  },
};

export default bike;
