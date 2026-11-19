import type { Translate } from "../../i18n";
import type { PlaneCardContent } from "./card";
import "./plane-card.css";

export interface PlaneCardView {
  /** Muestra o actualiza la tarjeta. `announce`: leerla a los lectores de pantalla (cambio de avión). */
  show(content: PlaneCardContent, announce: boolean): void;
  hide(): void;
  readonly visible: boolean;
  destroy(): void;
}

export interface PlaneCardOptions {
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

/** Tarjeta mínima de un avión: DOM propio (texto real, lector de pantalla), tokens, sin sombras. */
export function createPlaneCard({ t, onClose, host }: PlaneCardOptions): PlaneCardView {
  const root = el("section", "plane-card");
  root.hidden = true;
  root.setAttribute("aria-label", t("plane.card.region"));

  const head = el("div", "plane-card__head");
  const titles = el("div", "plane-card__titles");
  const kicker = el("p", "plane-card__layer", t("plane.name"));
  const title = el("h2", "plane-card__title");
  titles.append(kicker, title);
  const close = el("button", "plane-card__close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("plane.card.close"));
  close.addEventListener("click", onClose);
  head.append(titles, close);

  const rows = el("dl", "plane-card__rows");
  const note = el("p", "plane-card__note");
  const source = el("p", "plane-card__source");
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  root.append(head, rows, note, source, live);
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
    show(content, announce) {
      if (!visible) {
        visible = true;
        root.hidden = false;
        document.addEventListener("keydown", onKey);
      }
      // Se llama en cada fotograma: solo toca el DOM si cambió el contenido.
      if (content.summary !== rendered) {
        rendered = content.summary;
        title.textContent = content.title;
        rows.replaceChildren(
          ...content.rows.flatMap((r) => [
            el("dt", undefined, r.label),
            el("dd", undefined, r.value),
          ]),
        );
        note.textContent = content.note;
        note.classList.toggle("plane-card__note--estimated", content.estimated);
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
