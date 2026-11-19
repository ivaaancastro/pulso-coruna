import type { StationStatus } from "@pulso/schema";
import { INTL_LOCALE, type Locale, type Translate } from "../../i18n";
import { formatAgo, formatMadridTime } from "../../time/format";
import { fillFraction, fillRadius, RING_RADIUS, ringWidth, stationState } from "./bike-model";
import "./bike-card.css";

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
  element: HTMLElement;
  show(id: string): void;
  hide(): void;
  readonly selected: string | null;
}

const SVG = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Glifo del aro, con el mismo codificado que el mapa (grosor, área de relleno). */
function glyph(station: StationStatus): SVGSVGElement {
  const state = stationState(station);
  const width = ringWidth(state);
  const size = 2 * (RING_RADIUS + 3);
  const c = size / 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `bike-card__glyph bike-card__glyph--${state}`);
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

/**
 * Tarjeta mínima de una estación: bicis, huecos y «actualizado hace X». DOM propio (no es canvas),
 * así que lleva texto real y se lee con lector de pantalla. Se refresca sola con el reloj de la app.
 */
export function createBikeCard(opts: BikeCardOptions): BikeCard {
  const { t } = opts;
  const intl = INTL_LOCALE[opts.locale];
  const root = el("section", "bike-card");
  root.setAttribute("aria-label", t("bike.card.label"));
  root.hidden = true;

  const head = el("header", "bike-card__head");
  const glyphSlot = el("span", "bike-card__glyph-slot");
  const titles = el("div", "bike-card__titles");
  const layerName = el("p", "bike-card__layer", t("bike.name"));
  const title = el("h2", "bike-card__title");
  titles.append(layerName, title);
  const close = el("button", "bike-card__close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("bike.close"));
  head.append(glyphSlot, titles, close);

  const list = el("dl", "bike-card__stats");
  const bikesBox = el("div", "bike-card__stat");
  const bikesLabel = el("dt", undefined, t("bike.bikes"));
  const bikesValue = el("dd");
  bikesBox.append(bikesLabel, bikesValue);
  const docksBox = el("div", "bike-card__stat");
  const docksLabel = el("dt", undefined, t("bike.docks"));
  const docksValue = el("dd");
  docksBox.append(docksLabel, docksValue);
  list.append(bikesBox, docksBox);

  const stateLine = el("p", "bike-card__state");
  const updated = el("p", "bike-card__updated");
  root.append(head, list, stateLine, updated);
  opts.parent.append(root);

  let selected: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let renderedState: string | null = null;

  const render = (): void => {
    if (selected === null) return;
    const station = opts.read(selected);
    if (!station) {
      // La estación desapareció del almacén: no hay nada que mostrar.
      hide();
      opts.onClose();
      return;
    }
    const state = stationState(station);
    title.textContent = t("bike.station", { id: station.id });
    bikesValue.textContent = String(station.bikes);
    docksValue.textContent = String(station.docks);
    stateLine.textContent = state === "normal" ? "" : t(`bike.state.${state}`);
    stateLine.hidden = state === "normal";
    const key = `${state}:${station.bikes}:${station.docks}`;
    if (key !== renderedState) {
      glyphSlot.replaceChildren(glyph(station));
      renderedState = key;
    }
    const ago = formatAgo(station.ts, opts.now(), intl);
    updated.textContent = t("bike.updated", { ago });
    updated.title = formatMadridTime(station.ts, intl);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && selected !== null) {
      hide();
      opts.onClose();
    }
  };

  function hide(): void {
    selected = null;
    renderedState = null;
    root.hidden = true;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener("keydown", onKey);
  }

  close.addEventListener("click", () => {
    hide();
    opts.onClose();
  });

  return {
    element: root,
    get selected() {
      return selected;
    },
    show(id) {
      selected = id;
      renderedState = null;
      root.hidden = false;
      render();
      if (!timer) timer = setInterval(render, opts.refreshMs ?? 1000);
      document.addEventListener("keydown", onKey);
    },
    hide,
  };
}
