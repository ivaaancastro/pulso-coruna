import type { Translate } from "../../../i18n";
import type { ShipCardContent } from "./card";
import "./ship-card.css";

export interface ShipCardView {
  /** Muestra o actualiza la tarjeta. `announce`: leerla a los lectores de pantalla (cambio de barco). */
  show(content: ShipCardContent, announce: boolean): void;
  hide(): void;
  readonly visible: boolean;
  readonly element: HTMLElement;
  destroy(): void;
}

export interface ShipCardOptions {
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

/** Tarjeta mínima de un barco: DOM propio, tokens de diseño, sin sombras. */
export function createShipCard({ t, onClose, host }: ShipCardOptions): ShipCardView {
  const root = el("section", "ship-card");
  root.hidden = true;
  root.setAttribute("aria-label", t("ship.card.region"));

  const head = el("div", "ship-card__head");
  const mark = el("span", "ship-card__mark");
  mark.setAttribute("aria-hidden", "true");
  const title = el("h2", "ship-card__title");
  const close = el("button", "ship-card__close");
  close.type = "button";
  close.setAttribute("aria-label", t("ship.card.close"));
  close.textContent = "×";
  close.addEventListener("click", onClose);
  head.append(mark, title, close);

  const rows = el("dl", "ship-card__rows");
  const updated = el("p", "ship-card__updated");
  const source = el("p", "ship-card__source");
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  root.append(head, rows, updated, source, live);
  host.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") onClose();
  };
  let visible = false;
  let rendered = "";

  return {
    element: root,
    get visible() {
      return visible;
    },
    show(content, announce) {
      if (!visible) {
        visible = true;
        root.hidden = false;
        document.addEventListener("keydown", onKey);
      }
      // Solo toca el DOM si cambió el contenido (se llama en cada fotograma).
      const key = `${content.summary}|${content.updated}`;
      if (key !== rendered) {
        rendered = key;
        title.textContent = content.title;
        rows.replaceChildren(
          ...content.rows.flatMap((r) => [
            el("dt", undefined, r.label),
            el("dd", undefined, r.value),
          ]),
        );
        updated.textContent = content.updated;
        updated.title = content.updatedTitle;
        source.textContent = content.source;
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
