import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../../i18n";
import { createCardView, freshness, PANEL_ID, type CardModel } from "../card/panel";
import type { SeaView, Trend } from "./model";
import "./sea-ui.css";

export interface SeaUiOptions {
  /** Donde va el indicador (`.shell__top`). */
  chipParent: HTMLElement;
  /** Donde va la tarjeta (`#app`). */
  cardParent: HTMLElement;
  t: Translate;
  locale: Locale;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  /** Estado actual de la marea (cambia con cada lectura y con el paso del tiempo). */
  read: () => SeaView | null;
  /** La tarjeta se abrió o cerró desde el indicador, el botón de cerrar o Esc. */
  onOpenChange: (open: boolean) => void;
  /** Cada cuánto se refresca el texto, ms. */
  refreshMs?: number;
}

export interface SeaUi {
  chip: HTMLButtonElement;
  readonly card: HTMLElement;
  readonly open: boolean;
  setOpen(open: boolean): void;
  /** Vuelve a leer y pintar (tras una lectura nueva). */
  update(): void;
  /** Oculta el indicador y cierra la tarjeta (sin datos). */
  hide(): void;
  destroy(): void;
}

const SVG = "http://www.w3.org/2000/svg";
const GLYPH_W = 28;
const GLYPH_H = 20;

const TREND_KEY: Record<Trend, MessageKey> = {
  rising: "sea.trend.rising",
  falling: "sea.trend.falling",
  steady: "sea.trend.steady",
};

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

function line(x1: number, y1: number, x2: number, y2: number, width: number, opacity: number) {
  const n = document.createElementNS(SVG, "line");
  n.setAttribute("x1", String(x1));
  n.setAttribute("y1", String(y1));
  n.setAttribute("x2", String(x2));
  n.setAttribute("y2", String(y2));
  n.setAttribute("stroke", "currentColor");
  n.setAttribute("stroke-width", String(width));
  n.setAttribute("stroke-opacity", String(opacity));
  n.setAttribute("stroke-linecap", "round");
  return n;
}

/**
 * Glifo de la capa (direccion.md: «línea horizontal con marca de nivel»): dos marcas de rango y una
 * línea de nivel cuya altura es la fracción; la forma lleva el dato, no solo el color.
 */
export function levelGlyph(fraction: number): SVGSVGElement {
  const f = Math.min(1, Math.max(0, fraction));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${GLYPH_W} ${GLYPH_H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "sea-glyph");
  const top = 3;
  const bottom = GLYPH_H - 3;
  const y = bottom - (bottom - top) * f;
  svg.append(
    line(2, top, 8, top, 1.5, 0.45),
    line(2, bottom, 8, bottom, 1.5, 0.45),
    line(2, y, GLYPH_W - 2, y, 2.5, 1),
  );
  return svg;
}

/**
 * Indicador sobrio y tarjeta de la marea. DOM real (texto, no canvas): el indicador es un botón
 * accesible por teclado, la vía equivalente a tocar el mareógrafo en el mapa. Se refresca solo con
 * el reloj de la app. La tarjeta es el panel común (`live/card`).
 */
export function createSeaUi(opts: SeaUiOptions): SeaUi {
  const { t } = opts;
  const intl = INTL_LOCALE[opts.locale];
  const number = new Intl.NumberFormat(intl, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const meters = (v: number): string => `${number.format(v)} m`;

  const chip = el("button", "sea-chip");
  chip.type = "button";
  chip.hidden = true;
  chip.setAttribute("aria-expanded", "false");
  chip.setAttribute("aria-controls", PANEL_ID);
  const chipGlyph = el("span", "sea-chip__glyph");
  const chipText = el("span", "sea-chip__text");
  const chipHint = el("span", "sr-only", t("sea.chip.action"));
  chip.append(chipGlyph, chipText, chipHint);
  opts.chipParent.append(chip);

  const cardView = createCardView(opts.cardParent, "sea", {
    t,
    onClose: () => setOpen(false),
    returnFocus: () => chip,
  });

  let isOpen = false;
  let announceNext = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chipKey = "";

  const model = (view: SeaView, level: string): CardModel => ({
    layer: "sea",
    label: t("sea.card.label"),
    kicker: t("sea.name"),
    title: t("sea.card.label"),
    icon: { key: view.fraction.toFixed(3), build: () => levelGlyph(view.fraction) },
    groups: [
      {
        layout: "stats",
        columns: 2,
        rows: [
          { label: t("sea.level"), value: level, size: "lead" },
          {
            label: t("sea.trend"),
            value: view.trend ? t(TREND_KEY[view.trend]) : t("sea.trend.unknown"),
          },
        ],
      },
    ],
    notes: [{ text: t("sea.zero") }],
    updated: freshness(t, view.ts, opts.now(), opts.locale),
    attribution: { text: t("sea.source") },
  });

  const render = (): void => {
    const view = opts.read();
    if (!view) {
      hide();
      return;
    }
    const level = meters(view.value);
    chip.hidden = false;
    if (!timer)
      timer = setInterval(() => (document.hidden ? undefined : render()), opts.refreshMs ?? 1000);
    chipText.textContent = view.trend
      ? t("sea.chip", { level, trend: t(TREND_KEY[view.trend]) })
      : t("sea.chip.notrend", { level });
    const key = `${view.fraction.toFixed(3)}`;
    if (key !== chipKey) {
      chipKey = key;
      chipGlyph.replaceChildren(levelGlyph(view.fraction));
    }
    if (!isOpen) return;
    cardView.show(model(view, level), announceNext);
    announceNext = false;
  };

  function setOpen(open: boolean): void {
    if (open && chip.hidden) return;
    if (open === isOpen) return;
    isOpen = open;
    chip.setAttribute("aria-expanded", String(open));
    if (open) announceNext = true;
    else cardView.hide();
    render();
    opts.onOpenChange(open);
  }

  function hide(): void {
    chip.hidden = true;
    if (timer) clearInterval(timer);
    timer = null;
    chipKey = "";
    if (isOpen) setOpen(false);
  }

  chip.addEventListener("click", () => setOpen(!isOpen));

  return {
    chip,
    get card() {
      return cardView.element;
    },
    get open() {
      return isOpen;
    },
    setOpen,
    update: render,
    hide,
    destroy() {
      if (timer) clearInterval(timer);
      timer = null;
      cardView.destroy();
      chip.remove();
    },
  };
}
