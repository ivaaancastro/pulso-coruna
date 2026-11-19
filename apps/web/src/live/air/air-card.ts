import { INTL_LOCALE, type Locale, type Translate } from "../../i18n";
import { formatAgo, formatMadridTime } from "../../time/format";
import {
  AIR_LEVELS,
  ATTRIBUTION,
  ATTRIBUTION_URL,
  LEVEL_RGB,
  POLLUTANTS,
  rgbCss,
  type AirLevel,
  type AirReading,
} from "./model";
import "./air-card.css";

export interface AirCardOptions {
  parent: HTMLElement;
  t: Translate;
  locale: Locale;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  /** La tarjeta se abrió o se cerró (por el usuario o por `Esc`). */
  onToggle?: (open: boolean) => void;
  /** Cada cuánto se refresca el texto, ms. */
  refreshMs?: number;
}

export interface AirCard {
  badge: HTMLButtonElement;
  panel: HTMLElement;
  /** Lectura vigente, o `null` si no hay: oculta etiqueta y tarjeta. */
  update(reading: AirReading | null): void;
  /** `true`: fuente sin datos; oculta etiqueta y tarjeta aunque haya una lectura vieja. */
  suppress(value: boolean): void;
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

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

/** Escala de 6 segmentos con N rellenos (el nivel no depende solo del color). */
function scale(level: AirLevel): HTMLElement {
  const root = el("span", "air-scale");
  root.setAttribute("aria-hidden", "true");
  for (const l of AIR_LEVELS) {
    const seg = el("i", l <= level ? "air-scale__seg air-scale__seg--on" : "air-scale__seg");
    if (l <= level) seg.style.setProperty("--seg", rgbCss(LEVEL_RGB[l]));
    root.append(seg);
  }
  return root;
}

/**
 * Etiqueta «modelo» (siempre visible mientras hay halo, y vía por teclado a la tarjeta) y tarjeta con
 * el detalle. DOM propio, con texto real: se lee con lector de pantalla.
 */
export function createAirCard(opts: AirCardOptions): AirCard {
  const { t } = opts;
  const intl = INTL_LOCALE[opts.locale];
  const number = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 });

  // — Etiqueta
  const badge = el("button", "air-badge");
  badge.type = "button";
  badge.hidden = true;
  badge.setAttribute("aria-expanded", "false");
  const badgeName = el("span", "air-badge__name", t("air.badge"));
  const badgeLevel = el("span", "air-badge__level");
  const badgeAttr = el("span", "air-badge__attr", ATTRIBUTION);
  badge.append(badgeName, badgeLevel, badgeAttr);

  // — Tarjeta
  const panel = el("section", "air-card");
  panel.id = "air-card";
  panel.setAttribute("aria-label", t("air.card.label"));
  panel.hidden = true;
  badge.setAttribute("aria-controls", panel.id);

  const head = el("header", "air-card__head");
  const titles = el("div", "air-card__titles");
  const layerName = el("p", "air-card__layer", t("air.name"));
  const title = el("h2", "air-card__title");
  titles.append(layerName, title);
  const close = el("button", "air-card__close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("air.close"));
  head.append(titles, close);

  const eaqiBox = el("div", "air-card__eaqi");
  const eaqiLabel = el("p", "air-card__label", t("air.eaqi"));
  const eaqiValue = el("p", "air-card__eaqi-value");
  const eaqiScale = el("div", "air-card__scale");
  eaqiBox.append(eaqiLabel, eaqiValue, eaqiScale);

  const modelNote = el("p", "air-card__model", t("air.model"));
  const cityNote = el("p", "air-card__note", t("air.city"));

  const pollutantsLabel = el("p", "air-card__label", t("air.pollutants"));
  const list = el("dl", "air-card__stats");
  const values = new Map<string, HTMLElement>();
  for (const { metric, label } of POLLUTANTS) {
    const box = el("div", "air-card__stat");
    const dt = el("dt", undefined, label);
    const dd = el("dd");
    values.set(metric, dd);
    box.append(dt, dd);
    list.append(box);
  }

  const updated = el("p", "air-card__updated");
  const attribution = el("p", "air-card__attr");
  const link = el("a", undefined, ATTRIBUTION);
  link.href = ATTRIBUTION_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  attribution.append(link);

  panel.append(head, eaqiBox, modelNote, cityNote, pollutantsLabel, list, updated, attribution);
  opts.parent.append(badge, panel);

  let reading: AirReading | null = null;
  let suppressed = false;
  let isOpen = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let renderedKey: string | null = null;

  const visible = (): boolean => reading !== null && !suppressed;

  const renderText = (): void => {
    if (!reading) return;
    const ago = formatAgo(reading.ts, opts.now(), intl);
    updated.textContent = t("air.updated", { ago });
    updated.title = formatMadridTime(reading.ts, intl);
  };

  const render = (): void => {
    badge.hidden = !visible();
    if (!visible()) {
      if (isOpen) close_();
      return;
    }
    if (!reading) return;
    const word = t(`air.level.${reading.level}`);
    const key = `${reading.level}:${reading.eaqi}:${reading.ts}:${JSON.stringify(reading.pollutants)}`;
    if (key !== renderedKey) {
      renderedKey = key;
      const color = rgbCss(LEVEL_RGB[reading.level]);
      badgeLevel.replaceChildren(scale(reading.level), el("span", "air-badge__word", word));
      badge.style.setProperty("--level", color);
      badge.setAttribute("aria-label", t("air.badge.label", { level: word }));
      panel.style.setProperty("--level", color);
      title.textContent = t("air.title", { level: word });
      eaqiValue.textContent = t("air.eaqi.value", {
        value: number.format(reading.eaqi),
        level: String(reading.level),
      });
      eaqiScale.replaceChildren(scale(reading.level));
      for (const { metric } of POLLUTANTS) {
        const dd = values.get(metric);
        if (!dd) continue;
        const p = reading.pollutants[metric];
        dd.textContent = p ? `${number.format(p.value)} ${p.unit}` : "—";
      }
      modelNote.hidden = !reading.model;
      cityNote.hidden = !reading.model;
    }
    renderText();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && isOpen) close_();
  };

  function setOpen(next: boolean): void {
    if (next === isOpen) return;
    isOpen = next;
    panel.hidden = !next;
    badge.setAttribute("aria-expanded", String(next));
    if (next) {
      renderText();
      timer ??= setInterval(renderText, opts.refreshMs ?? 1000);
      document.addEventListener("keydown", onKey);
    } else {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("keydown", onKey);
    }
    opts.onToggle?.(next);
  }

  function close_(): void {
    setOpen(false);
  }

  badge.addEventListener("click", () => setOpen(!isOpen));
  close.addEventListener("click", close_);

  return {
    badge,
    panel,
    get isOpen() {
      return isOpen;
    },
    update(next) {
      reading = next;
      render();
    },
    suppress(value) {
      if (value === suppressed) return;
      suppressed = value;
      render();
    },
    open() {
      if (visible()) setOpen(true);
    },
    close: close_,
    toggle() {
      if (isOpen) close_();
      else if (visible()) setOpen(true);
    },
  };
}
