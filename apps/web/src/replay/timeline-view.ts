import { INTL_LOCALE, type Locale, type Translate } from "../i18n";
import { DISPLAY_TZ, formatMadridTime } from "../time/format";
import { SPEEDS, type ReplaySpeed } from "./types";
import "./timeline.css";

export type StatusKind = "none" | "loading" | "error" | "nodata" | "coarse" | "ended";

export interface TimelineModel {
  /** Instante actual (epoch ms UTC). */
  t: number;
  /** Día de Madrid mostrado: `[dayStart, dayEnd)`. */
  dayStart: number;
  dayEnd: number;
  /** Último instante al que se puede llegar (hoy: «ahora»; otro día: su final). */
  limit: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** Mensaje bajo la barra: carga, error, sin datos… (`none`: nada). */
  status: { kind: StatusKind; text: string };
}

export interface TimelineHandlers {
  onSeek(t: number): void;
  onScrubStart(): void;
  onScrubEnd(): void;
  onToggle(): void;
  onSpeed(speed: ReplaySpeed): void;
  onDay(dayStart: number): void;
}

export interface TimelineViewOptions {
  t: Translate;
  locale: Locale;
  /** Días seleccionables, del más reciente al más antiguo. */
  days: readonly number[];
  /** Día de «hoy» (el primero de `days`). */
  today: number;
  handlers: TimelineHandlers;
}

export interface TimelineView {
  element: HTMLElement;
  update(model: TimelineModel): void;
  /** Altura actual en px (para reservar sitio a las tarjetas). */
  destroy(): void;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const PLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

/** Pasos del teclado en el cursor (ms). */
export const KEY_STEPS = { fine: MIN, coarse: 5 * MIN, page: HOUR } as const;

/**
 * Cambio de instante que pide una tecla sobre el cursor, o `null` si la tecla no es del cursor.
 * Flechas ±1 min (±5 con Mayús), AvPág/RePág ±1 h; Inicio/Fin llevan a los extremos del día.
 */
export function keyboardTarget(
  key: string,
  shift: boolean,
  t: number,
  dayStart: number,
  limit: number,
): number | null {
  const step = shift ? KEY_STEPS.coarse : KEY_STEPS.fine;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(dayStart, t - step);
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(limit, t + step);
    case "PageDown":
      return Math.max(dayStart, t - KEY_STEPS.page);
    case "PageUp":
      return Math.min(limit, t + KEY_STEPS.page);
    case "Home":
      return dayStart;
    case "End":
      return limit;
    default:
      return null;
  }
}

/**
 * Barra de tiempo (docs/design/direccion.md: «Reproducir muestra una barra de tiempo fina»): botón
 * reproducir/pausa, selector de día, velocidades 1×/60×/600× y el cursor sobre las 24 h del día.
 * El cursor es un `role="slider"` (teclado y puntero). DOM real; solo tokens. La hora grande es la
 * del reloj de la app (arriba), que en Reproducir sigue al cursor.
 */
export function createTimelineView(opts: TimelineViewOptions): TimelineView {
  const { t, handlers } = opts;
  const intl = INTL_LOCALE[opts.locale];

  const root = document.createElement("section");
  root.className = "timeline";
  root.setAttribute("aria-label", t("replay.label"));
  root.hidden = true;

  // Fila de controles.
  const row = document.createElement("div");
  row.className = "timeline__row";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "timeline__play";
  play.addEventListener("click", () => handlers.onToggle());

  const dayWrap = document.createElement("label");
  dayWrap.className = "timeline__day";
  const dayLabel = document.createElement("span");
  dayLabel.className = "sr-only";
  dayLabel.textContent = t("replay.day");
  const select = document.createElement("select");
  select.className = "timeline__select";
  const dayFmt = new Intl.DateTimeFormat(intl, {
    timeZone: DISPLAY_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  for (const day of opts.days) {
    const option = document.createElement("option");
    option.value = String(day);
    const text = dayFmt.format(day);
    option.textContent = day === opts.today ? `${t("replay.today")} · ${text}` : text;
    select.append(option);
  }
  select.addEventListener("change", () => handlers.onDay(Number(select.value)));
  dayWrap.append(dayLabel, select);

  const speeds = document.createElement("div");
  speeds.className = "timeline__speeds";
  speeds.setAttribute("role", "radiogroup");
  speeds.setAttribute("aria-label", t("replay.speed"));
  const speedButtons = new Map<ReplaySpeed, HTMLButtonElement>();
  for (const speed of SPEEDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline__speed";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", t("replay.speed.option", { n: String(speed) }));
    button.textContent = `${speed}×`;
    button.dataset["speed"] = String(speed);
    button.addEventListener("click", () => handlers.onSpeed(speed));
    speedButtons.set(speed, button);
    speeds.append(button);
  }
  speeds.addEventListener("keydown", (event) => {
    const i = SPEEDS.indexOf(
      Number((event.target as HTMLElement).textContent?.replace("×", "")) as ReplaySpeed,
    );
    if (i < 0) return;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? SPEEDS[(i + 1) % SPEEDS.length]
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? SPEEDS[(i - 1 + SPEEDS.length) % SPEEDS.length]
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    speedButtons.get(next)?.focus();
    handlers.onSpeed(next);
  });
  row.append(play, dayWrap, speeds);

  // Cursor sobre las 24 h.
  const track = document.createElement("div");
  track.className = "timeline__track";
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", t("replay.slider"));
  track.setAttribute("aria-valuemin", "0");
  const rail = document.createElement("div");
  rail.className = "timeline__rail";
  const future = document.createElement("div");
  future.className = "timeline__future";
  const fill = document.createElement("div");
  fill.className = "timeline__fill";
  const thumb = document.createElement("div");
  thumb.className = "timeline__thumb";
  const ticks = document.createElement("div");
  ticks.className = "timeline__ticks";
  ticks.setAttribute("aria-hidden", "true");
  track.append(rail, future, fill, thumb);

  const status = document.createElement("p");
  status.className = "timeline__status";
  status.setAttribute("role", "status");

  root.append(row, track, ticks, status);

  // Estado interno.
  let model: TimelineModel | null = null;
  let width = 0;
  let dragging = false;
  let lastValueText = "";
  let tickKey = "";

  const measure = (): void => {
    width = track.clientWidth;
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  ro?.observe(track);

  const fractionOf = (ms: number, m: TimelineModel): number =>
    m.dayEnd > m.dayStart
      ? Math.min(1, Math.max(0, (ms - m.dayStart) / (m.dayEnd - m.dayStart)))
      : 0;

  const seekAt = (clientX: number): void => {
    if (!model) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    handlers.onSeek(model.dayStart + f * (model.dayEnd - model.dayStart));
  };

  track.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !model) return;
    event.preventDefault();
    track.focus({ preventScroll: true });
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      /* sin captura (jsdom, puntero ya liberado): el arrastre sigue por los eventos del elemento */
    }
    dragging = true;
    track.dataset["dragging"] = "true";
    handlers.onScrubStart();
    seekAt(event.clientX);
  });
  track.addEventListener("pointermove", (event) => {
    if (dragging) seekAt(event.clientX);
  });
  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    delete track.dataset["dragging"];
    handlers.onScrubEnd();
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("lostpointercapture", endDrag);

  track.addEventListener("keydown", (event) => {
    if (!model || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault();
      handlers.onToggle();
      return;
    }
    const target = keyboardTarget(event.key, event.shiftKey, model.t, model.dayStart, model.limit);
    if (target === null) return;
    event.preventDefault();
    handlers.onSeek(target);
  });

  const renderTicks = (m: TimelineModel): void => {
    const key = `${m.dayStart}|${m.dayEnd}`;
    if (key === tickKey) return;
    tickKey = key;
    ticks.replaceChildren();
    // Cada 6 h de reloj transcurrido; la etiqueta es la hora local real de ese instante (en los
    // días de cambio de hora no cae en «06:00» exacto, y es lo honesto).
    for (let k = 0; k <= 4; k++) {
      const ms = k === 4 ? m.dayEnd : m.dayStart + k * 6 * HOUR;
      const f = fractionOf(ms, m);
      const label = document.createElement("span");
      label.className = "timeline__tick";
      label.style.setProperty("--f", String(f));
      label.dataset["edge"] = k === 0 ? "start" : k === 4 ? "end" : "mid";
      label.textContent = k === 4 ? "24:00" : formatMadridTime(ms, intl);
      ticks.append(label);
    }
  };

  const total = (m: TimelineModel): number =>
    Math.max(1, Math.round((m.dayEnd - m.dayStart) / MIN));

  return {
    element: root,
    update(next) {
      const prev = model;
      model = next;
      if (width === 0) measure();
      const f = fractionOf(next.t, next);
      thumb.style.transform = `translate3d(${(f * width).toFixed(1)}px, 0, 0)`;
      fill.style.transform = `scaleX(${f.toFixed(5)})`;
      const limitF = fractionOf(next.limit, next);
      future.style.transform = `scaleX(${(1 - limitF).toFixed(5)})`;

      const minutes = Math.round((next.t - next.dayStart) / MIN);
      const valueText = formatMadridTime(next.t, intl);
      if (valueText !== lastValueText) {
        lastValueText = valueText;
        track.setAttribute("aria-valuenow", String(minutes));
        track.setAttribute("aria-valuetext", valueText);
      }
      if (!prev || prev.dayEnd !== next.dayEnd || prev.dayStart !== next.dayStart) {
        track.setAttribute("aria-valuemax", String(total(next)));
        select.value = String(next.dayStart);
      }
      renderTicks(next);

      if (!prev || prev.playing !== next.playing) {
        play.innerHTML = next.playing ? PAUSE_ICON : PLAY_ICON;
        play.setAttribute("aria-label", next.playing ? t("replay.pause") : t("replay.play"));
      }
      if (!prev || prev.speed !== next.speed) {
        for (const [speed, button] of speedButtons) {
          button.setAttribute("aria-checked", String(speed === next.speed));
          button.tabIndex = speed === next.speed ? 0 : -1;
        }
      }
      const kind = next.status.kind;
      if (status.dataset["kind"] !== kind || status.textContent !== next.status.text) {
        status.dataset["kind"] = kind;
        status.textContent = next.status.text;
        status.hidden = kind === "none";
      }
      root.dataset["loading"] = String(kind === "loading");
    },
    destroy() {
      endDrag();
      ro?.disconnect();
      root.remove();
    },
  };
}
