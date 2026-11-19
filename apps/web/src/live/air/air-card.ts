import { INTL_LOCALE, type Locale, type Translate } from "../../i18n";
import { createCardView, freshness, PANEL_ID, type CardModel } from "../card/panel";
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
  /** El panel de detalle compartido (`live/card`). */
  readonly panel: HTMLElement;
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
function scale(level: AirLevel, wide = false): HTMLElement {
  const root = el("span", wide ? "air-scale air-scale--wide" : "air-scale");
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

  // — Tarjeta (panel común)
  badge.setAttribute("aria-controls", PANEL_ID);
  const view = createCardView(opts.parent, "air", {
    t,
    onClose: () => setOpen(false),
    returnFocus: () => badge,
  });
  opts.parent.append(badge);

  let reading: AirReading | null = null;
  let suppressed = false;
  let isOpen = false;
  let announceNext = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let renderedKey: string | null = null;

  const visible = (): boolean => reading !== null && !suppressed;

  const model = (r: AirReading): CardModel => {
    const word = t(`air.level.${r.level}`);
    return {
      layer: "air",
      label: t("air.card.label"),
      kicker: t("air.name"),
      title: t("air.title", { level: word }),
      accent: rgbCss(LEVEL_RGB[r.level]),
      groups: [
        {
          rows: [
            {
              label: t("air.eaqi"),
              value: t("air.eaqi.value", { value: number.format(r.eaqi), level: String(r.level) }),
              extra: () => scale(r.level, true),
            },
          ],
        },
        {
          heading: t("air.pollutants"),
          layout: "stats",
          columns: 3,
          rows: POLLUTANTS.map(({ metric, label }) => {
            const p = r.pollutants[metric];
            return { label, value: p ? `${number.format(p.value)} ${p.unit}` : "—" };
          }),
        },
      ],
      notes: r.model ? [{ text: t("air.model"), kind: "model" }, { text: t("air.city") }] : [],
      updated: freshness(t, r.ts, opts.now(), opts.locale),
      attribution: { text: ATTRIBUTION, href: ATTRIBUTION_URL },
    };
  };

  const paintCard = (): void => {
    if (!isOpen || !reading) return;
    view.show(model(reading), announceNext);
    announceNext = false;
  };

  const render = (): void => {
    badge.hidden = !visible();
    if (!visible()) {
      if (isOpen) setOpen(false);
      return;
    }
    if (!reading) return;
    const word = t(`air.level.${reading.level}`);
    const key = `${reading.level}:${reading.eaqi}:${reading.ts}:${JSON.stringify(reading.pollutants)}`;
    if (key !== renderedKey) {
      renderedKey = key;
      badgeLevel.replaceChildren(scale(reading.level), el("span", "air-badge__word", word));
      badge.style.setProperty("--level", rgbCss(LEVEL_RGB[reading.level]));
      badge.setAttribute("aria-label", t("air.badge.label", { level: word }));
    }
    paintCard();
  };

  function setOpen(next: boolean): void {
    if (next === isOpen) return;
    isOpen = next;
    badge.setAttribute("aria-expanded", String(next));
    if (next) {
      announceNext = true;
      paintCard();
      timer ??= setInterval(paintCard, opts.refreshMs ?? 1000);
    } else {
      if (timer) clearInterval(timer);
      timer = null;
      view.hide();
    }
    opts.onToggle?.(next);
  }

  badge.addEventListener("click", () => setOpen(!isOpen));

  return {
    badge,
    get panel() {
      return view.element;
    },
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
    close() {
      setOpen(false);
    },
    toggle() {
      if (isOpen) setOpen(false);
      else if (visible()) setOpen(true);
    },
  };
}
