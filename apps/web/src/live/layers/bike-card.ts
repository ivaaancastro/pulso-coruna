import type { StationStatus } from "@pulso/schema";
import type { Locale, Translate } from "../../i18n";
import { createCardView, freshness, type CardModel } from "../card/panel";
import { fillFraction, fillRadius, RING_RADIUS, ringWidth, stationState } from "./bike-model";

export interface BikeCardOptions {
  parent: HTMLElement;
  t: Translate;
  locale: Locale;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  /** Estado actual de una estación (el almacén cambia mientras la tarjeta está abierta). */
  read: (id: string) => StationStatus | undefined;
  /** El usuario cerró la tarjeta (botón o Esc). */
  onClose: () => void;
  /** Cada cuánto se refresca el texto, ms. */
  refreshMs?: number;
}

export interface BikeCard {
  /** El panel de detalle compartido (`live/card`). */
  readonly element: HTMLElement;
  show(id: string): void;
  hide(): void;
  readonly selected: string | null;
}

const SVG = "http://www.w3.org/2000/svg";

/** Glifo del aro, con el mismo codificado que el mapa (grosor, área de relleno). */
function glyph(station: StationStatus): SVGSVGElement {
  const state = stationState(station);
  const width = ringWidth(state);
  const size = 2 * (RING_RADIUS + 3);
  const c = size / 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  if (state === "out") svg.style.opacity = "var(--pulso-layer-muted-opacity)";
  const ring = document.createElementNS(SVG, "circle");
  ring.setAttribute("cx", String(c));
  ring.setAttribute("cy", String(c));
  ring.setAttribute("r", String(RING_RADIUS));
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "currentColor");
  ring.setAttribute("stroke-width", String(width));
  svg.append(ring);
  const r = state === "out" ? 0 : fillRadius(fillFraction(station), width);
  if (r > 0) {
    const fill = document.createElementNS(SVG, "circle");
    fill.setAttribute("cx", String(c));
    fill.setAttribute("cy", String(c));
    fill.setAttribute("r", String(r));
    fill.setAttribute("fill", "currentColor");
    svg.append(fill);
  }
  return svg;
}

/** Modelo de la tarjeta de una estación: bicis, huecos y estado, sin DOM. */
export function bikeCardModel(
  station: StationStatus,
  t: Translate,
  locale: Locale,
  now: number,
): CardModel {
  const state = stationState(station);
  return {
    layer: "bike",
    label: t("bike.card.label"),
    kicker: t("bike.name"),
    title: t("bike.station", { id: station.id }),
    icon: { key: `${state}:${station.bikes}:${station.docks}`, build: () => glyph(station) },
    groups: [
      {
        layout: "stats",
        columns: 2,
        rows: [
          { label: t("bike.bikes"), value: String(station.bikes), size: "lead" },
          { label: t("bike.docks"), value: String(station.docks), size: "lead" },
        ],
      },
    ],
    notes: state === "normal" ? [] : [{ text: t(`bike.state.${state}`), kind: "state" }],
    updated: freshness(t, station.ts, now, locale),
  };
}

/**
 * Tarjeta de una estación sobre el panel común: bicis, huecos y «actualizado hace X». Se refresca
 * sola con el reloj de la app; los cambios de estado (vacía, llena) se anuncian con `aria-live`.
 */
export function createBikeCard(opts: BikeCardOptions): BikeCard {
  const view = createCardView(opts.parent, "bike", { t: opts.t, onClose: () => close() });
  let selected: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let announced: string | null = null;

  const render = (): void => {
    if (selected === null) return;
    const station = opts.read(selected);
    if (!station) {
      // La estación desapareció del almacén: no hay nada que mostrar.
      hide();
      opts.onClose();
      return;
    }
    // Se anuncia al abrir y cuando cambia el estado (vacía/llena/sin servicio), no con el reloj.
    const state = stationState(station);
    view.show(bikeCardModel(station, opts.t, opts.locale, opts.now()), announced !== state);
    announced = state;
  };

  function hide(): void {
    selected = null;
    announced = null;
    if (timer) clearInterval(timer);
    timer = null;
    view.hide();
  }

  /** Cierre del usuario (botón, Esc) o por otra tarjeta: suelta la selección. */
  function close(): void {
    if (selected === null) return;
    hide();
    opts.onClose();
  }

  return {
    get element() {
      return view.element;
    },
    get selected() {
      return selected;
    },
    show(id) {
      if (selected !== id) announced = null;
      selected = id;
      render();
      if (selected !== null && !timer) timer = setInterval(render, opts.refreshMs ?? 1000);
    },
    hide,
  };
}
