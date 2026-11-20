import type { MessageKey, Translate } from "../i18n";
import { createNumberAnimator, type NumberAnimator } from "../pulse/animation";
import { seriesStats, type PulseSnapshot, type PulseStatus } from "../pulse/model";
import { SERIES_H, SERIES_W, buildSeries } from "../pulse/series";

const SVG_NS = "http://www.w3.org/2000/svg";
const NO_VALUE = "–";

const NOTE_KEY: Partial<Record<PulseStatus, MessageKey>> = {
  loading: "pulse.loading",
  nodata: "pulse.nodata",
  error: "pulse.error",
  stale: "pulse.stale",
};

export interface PulseIndex {
  element: HTMLElement;
  /** Pinta un estado (lo llama el controlador cada segundo: solo toca el DOM si algo cambió). */
  render(snapshot: PulseSnapshot): void;
  destroy(): void;
}

export interface PulseIndexOptions {
  reducedMotion?: () => boolean;
  perf?: () => number;
  raf?: (cb: () => void) => () => void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Índice Pulso: número grande (contador con easing; directo con prefers-reduced-motion), serie de
 * las últimas 24 h (SVG propio con `role="img"` y texto alternativo) y una nota de estado. Sin datos
 * el número se atenúa y se explica; con `profile:"fixed"` se etiqueta que el nivel no está calibrado.
 * Los datos los trae `pulse/start.ts` (chunk diferido); aquí no hay red ni zod.
 */
export function createPulseIndex(t: Translate, options: PulseIndexOptions = {}): PulseIndex {
  const reduced =
    options.reducedMotion ??
    ((): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches);

  const root = document.createElement("section");
  root.className = "pulse";
  root.dataset.status = "loading";
  root.setAttribute("aria-label", t("pulse.label"));

  const label = document.createElement("p");
  label.className = "pulse__label";
  label.textContent = t("pulse.label");

  const figure = document.createElement("p");
  figure.className = "pulse__value";
  const number = document.createElement("span");
  number.className = "pulse__number";
  number.setAttribute("aria-hidden", "true");
  number.textContent = NO_VALUE;
  const scale = document.createElement("span");
  scale.className = "pulse__scale";
  scale.setAttribute("aria-hidden", "true");
  scale.textContent = t("pulse.scale");
  const spoken = document.createElement("span");
  spoken.className = "pulse__sr";
  figure.append(number, " ", scale, spoken);

  const svg = svgEl("svg", {
    class: "pulse__series",
    viewBox: `0 0 ${SERIES_W} ${SERIES_H}`,
    width: String(SERIES_W),
    height: String(SERIES_H),
    role: "img",
  });
  const mid = svgEl("line", { class: "pulse__mid", x1: "3", x2: String(SERIES_W - 3) });
  const area = svgEl("path", { class: "pulse__area" });
  const line = svgEl("path", { class: "pulse__line" });
  const dot = svgEl("circle", { class: "pulse__dot", r: "2.5" });
  svg.append(mid, area, line, dot);

  const note = document.createElement("p");
  note.className = "pulse__note";
  // Región educada: solo se anuncia el cambio de estado (la nota), no cada refresco del valor.
  note.setAttribute("role", "status");

  root.append(label, figure, svg, note);

  const animator: NumberAnimator = createNumberAnimator({
    paint: (n) => {
      number.textContent = String(n);
    },
    reducedMotion: reduced,
    ...(options.perf ? { perf: options.perf } : {}),
    ...(options.raf ? { raf: options.raf } : {}),
  });

  let lastKey = "";

  const render = (s: PulseSnapshot): void => {
    // La clave deja fuera `t`: el DOM solo cambia si cambia el valor, el estado o la serie visible.
    const lastTs = s.points[s.points.length - 1]?.ts ?? 0;
    const key = `${s.status}|${s.value}|${s.profile}|${s.points.length}|${lastTs}|${s.window?.to ?? 0}`;
    if (key === lastKey) return;
    lastKey = key;

    root.dataset.status = s.status;
    root.dataset.profile = s.profile ?? "";
    root.setAttribute("aria-busy", s.status === "loading" ? "true" : "false");

    if (s.value === null) {
      animator.reset();
      number.textContent = NO_VALUE;
      spoken.textContent = "";
    } else {
      animator.to(s.value);
      spoken.textContent = t("pulse.value.alt", { value: String(Math.round(s.value)) });
    }

    const statusKey = NOTE_KEY[s.status];
    const fixed = s.profile === "fixed";
    note.textContent = statusKey ? t(statusKey) : fixed ? t("pulse.profile.fixed") : "";
    // «Perfil fijo» se ve siempre que haya valor, también atenuado (honestidad: nivel sin calibrar).
    root.dataset.fixed = fixed && s.value !== null ? "true" : "false";
    if (statusKey && fixed && s.value !== null) {
      note.textContent = `${t(statusKey)} · ${t("pulse.profile.fixed")}`;
    }
    note.hidden = note.textContent === "";

    const stats = seriesStats(s.points);
    if (!s.window || !stats) {
      svg.setAttribute("aria-label", t("pulse.series.empty"));
      svg.dataset.empty = "true";
      area.setAttribute("d", "");
      line.setAttribute("d", "");
      dot.setAttribute("visibility", "hidden");
      return;
    }
    const geo = buildSeries(s.points, s.window.from, s.window.to, s.window.stepMs);
    svg.dataset.empty = "false";
    mid.setAttribute("y1", String(geo.midY));
    mid.setAttribute("y2", String(geo.midY));
    area.setAttribute("d", geo.area);
    line.setAttribute("d", geo.line);
    dot.setAttribute("visibility", geo.last ? "visible" : "hidden");
    if (geo.last) {
      dot.setAttribute("cx", String(geo.last.x));
      dot.setAttribute("cy", String(geo.last.y));
    }
    svg.setAttribute(
      "aria-label",
      t("pulse.series.alt", {
        min: String(Math.round(stats.min)),
        max: String(Math.round(stats.max)),
        now: String(Math.round(stats.last)),
      }),
    );
  };

  // Estado inicial (cargando) sin esperar al controlador.
  svg.setAttribute("aria-label", t("pulse.series.empty"));
  svg.dataset.empty = "true";
  mid.setAttribute("y1", String(SERIES_H / 2));
  mid.setAttribute("y2", String(SERIES_H / 2));
  note.textContent = t("pulse.loading");

  return { element: root, render, destroy: () => animator.destroy() };
}
