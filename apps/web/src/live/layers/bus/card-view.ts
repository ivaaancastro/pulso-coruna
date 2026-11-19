import type { Translate } from "../../../i18n";
import type { BusCardContent } from "./card";
import type { Rgb } from "./line-color";
import "./bus-card.css";

export interface BusCardView {
  /** Muestra o actualiza la tarjeta. `announce`: leerla a los lectores de pantalla (cambio de bus). */
  show(content: BusCardContent, color: Rgb, announce: boolean): void;
  hide(): void;
  readonly visible: boolean;
  destroy(): void;
}

export interface BusCardOptions {
  t: Translate;
  onClose: () => void;
  host: HTMLElement;
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

/** Tarjeta mínima de un bus: DOM propio, tokens de diseño, sin sombras. */
export function createBusCard({ t, onClose, host }: BusCardOptions): BusCardView {
  const root = el("section", "bus-card");
  root.hidden = true;
  root.setAttribute("aria-label", t("bus.card.region"));

  const head = el("div", "bus-card__head");
  const badge = el("span", "bus-card__badge");
  badge.setAttribute("aria-hidden", "true");
  const title = el("h2", "bus-card__title");
  const close = el("button", "bus-card__close");
  close.type = "button";
  close.setAttribute("aria-label", t("bus.card.close"));
  close.textContent = "×";
  close.addEventListener("click", onClose);
  head.append(badge, title, close);

  const rows = el("dl", "bus-card__rows");
  const note = el("p", "bus-card__note");
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  root.append(head, rows, note, live);
  host.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") onClose();
  };
  let visible = false;
  let rendered = "";

  return {
    get visible() {
      return visible;
    },
    show(content, color, announce) {
      if (!visible) {
        visible = true;
        root.hidden = false;
        document.addEventListener("keydown", onKey);
      }
      // Solo toca el DOM si cambió el contenido (se llama en cada fotograma).
      const key = `${content.summary}|${color.join(",")}`;
      if (key !== rendered) {
        rendered = key;
        badge.textContent = content.line ?? "";
        badge.hidden = content.line === undefined;
        badge.style.backgroundColor = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        title.textContent = content.title;
        rows.replaceChildren(
          ...content.rows.flatMap((r) => [
            el("dt", undefined, r.label),
            el("dd", undefined, r.value),
          ]),
        );
        note.textContent = content.note ?? "";
        note.hidden = content.note === undefined;
      }
      if (announce) live.textContent = content.summary;
    },
    hide() {
      if (!visible) return;
      visible = false;
      rendered = "";
      root.hidden = true;
      live.textContent = "";
      document.removeEventListener("keydown", onKey);
    },
    destroy() {
      document.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
