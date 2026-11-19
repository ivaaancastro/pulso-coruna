import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../../i18n";
import { formatAgo, formatMadridTime } from "../../time/format";
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
  card: HTMLElement;
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
 * el reloj de la app. La tarjeta sigue el patrón de `bike-card` (M5.3 unificará el diseño).
 */
export function createSeaUi(opts: SeaUiOptions): SeaUi {
  const { t } = opts;
  const intl = INTL_LOCALE[opts.locale];
  const number = new Intl.NumberFormat(intl, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const meters = (v: number): string => `${number.format(v)} m`;

  const cardId = "sea-card";
  const chip = el("button", "sea-chip");
  chip.type = "button";
  chip.hidden = true;
  chip.setAttribute("aria-expanded", "false");
  chip.setAttribute("aria-controls", cardId);
  const chipGlyph = el("span", "sea-chip__glyph");
  const chipText = el("span", "sea-chip__text");
  const chipHint = el("span", "sr-only", t("sea.chip.action"));
  chip.append(chipGlyph, chipText, chipHint);
  opts.chipParent.append(chip);

  const root = el("section", "sea-card");
  root.id = cardId;
  root.setAttribute("aria-label", t("sea.card.label"));
  root.hidden = true;

  const head = el("header", "sea-card__head");
  const glyphSlot = el("span", "sea-card__glyph-slot");
  const titles = el("div", "sea-card__titles");
  titles.append(el("p", "sea-card__layer", t("sea.name")));
  const title = el("h2", "sea-card__title");
  titles.append(title);
  const close = el("button", "sea-card__close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("sea.close"));
  head.append(glyphSlot, titles, close);

  const stats = el("dl", "sea-card__stats");
  const levelBox = el("div", "sea-card__stat");
  const levelValue = el("dd");
  levelBox.append(el("dt", undefined, t("sea.level")), levelValue);
  const trendBox = el("div", "sea-card__stat");
  const trendValue = el("dd", "sea-card__trend");
  trendBox.append(el("dt", undefined, t("sea.trend")), trendValue);
  stats.append(levelBox, trendBox);

  const zero = el("p", "sea-card__note", t("sea.zero"));
  const updated = el("p", "sea-card__updated");
  const source = el("p", "sea-card__note", t("sea.source"));
  root.append(head, stats, zero, updated, source);
  opts.cardParent.append(root);

  let isOpen = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chipKey = "";

  const trendText = (view: SeaView): string =>
    view.trend ? t(TREND_KEY[view.trend]) : t("sea.trend.unknown");

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
      glyphSlot.replaceChildren(levelGlyph(view.fraction));
    }
    if (!isOpen) return;
    title.textContent = t("sea.card.label");
    levelValue.textContent = level;
    trendValue.textContent = trendText(view);
    updated.textContent = t("sea.updated", { ago: formatAgo(view.ts, opts.now(), intl) });
    updated.title = formatMadridTime(view.ts, intl);
  };

  function setOpen(open: boolean): void {
    if (open && chip.hidden) return;
    if (open === isOpen) return;
    isOpen = open;
    root.hidden = !open;
    chip.setAttribute("aria-expanded", String(open));
    if (open) {
      document.addEventListener("keydown", onKey);
    } else {
      document.removeEventListener("keydown", onKey);
    }
    render();
    opts.onOpenChange(open);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && isOpen) {
      setOpen(false);
      chip.focus();
    }
  }

  function hide(): void {
    chip.hidden = true;
    if (timer) clearInterval(timer);
    timer = null;
    chipKey = "";
    if (isOpen) setOpen(false);
  }

  chip.addEventListener("click", () => setOpen(!isOpen));
  close.addEventListener("click", () => {
    setOpen(false);
    chip.focus();
  });

  return {
    chip,
    card: root,
    get open() {
      return isOpen;
    },
    setOpen,
    update: render,
    hide,
    destroy() {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("keydown", onKey);
      chip.remove();
      root.remove();
    },
  };
}
