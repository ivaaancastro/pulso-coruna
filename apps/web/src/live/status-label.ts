import type { LayerId } from "@pulso/schema";
import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../i18n";
import { formatAgo } from "../time/format";
import type { SourceMonitor } from "./source-monitor";
import "./status-label.css";

export interface StatusLabelOptions {
  parent: HTMLElement;
  t: Translate;
  locale: Locale;
  /** Reloj de la app (`time/now.ts`). */
  now: () => number;
  monitor: SourceMonitor;
  /** Cada cuánto se refresca el texto visible («hace 7 min»), ms. */
  refreshMs?: number;
}

export interface StatusLabel {
  element: HTMLElement;
  destroy(): void;
}

type Kind = "delayed" | "nodata" | "reconnecting";

interface Entry {
  /** Capa, o `net` para la conexión. */
  id: string;
  kind: Kind;
  layer?: LayerId;
  text: string;
}

const LAYER_KEY = (layer: LayerId): MessageKey => `status.layer.${layer}`;
/** Capa → token de color (`weather` se pinta con el del viento). */
const TOKEN: Partial<Record<LayerId, string>> = { weather: "wind" };

/**
 * Etiqueta de estado de los datos: una línea por capa afectada («Bus: sin datos desde hace 7 min») o,
 * si lo que falla es nuestra conexión, una sola («Reconectando…») que no culpa a ninguna fuente.
 * Es DOM real (texto, no canvas). El texto visible se refresca solo, sin `aria-live` (los minutos
 * cambiarían a cada rato); un `role="status"` educado, oculto, anuncia únicamente las transiciones.
 */
export function createStatusLabel(opts: StatusLabelOptions): StatusLabel {
  const { t, monitor } = opts;
  const intl = INTL_LOCALE[opts.locale];

  const root = document.createElement("section");
  root.className = "source-status";
  root.setAttribute("aria-label", t("status.region"));
  root.hidden = true;
  const list = document.createElement("ul");
  list.className = "source-status__list";
  const live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.append(list, live);
  opts.parent.append(root);

  const entries = (): Entry[] => {
    if (monitor.disconnected) {
      return [{ id: "net", kind: "reconnecting", text: t("status.reconnecting") }];
    }
    const out: Entry[] = [];
    const now = opts.now();
    for (const layer of monitor.layers) {
      const { state, lastDataAt } = monitor.status(layer);
      if (state !== "delayed" && state !== "nodata") continue;
      const name = t(LAYER_KEY(layer));
      const ago = lastDataAt === null ? null : formatAgo(lastDataAt, now, intl);
      const text =
        state === "nodata"
          ? ago === null
            ? t("status.nodata.unknown", { layer: name })
            : t("status.nodata", { layer: name, ago })
          : ago === null
            ? t("status.delayed.short", { layer: name })
            : t("status.delayed", { layer: name, ago });
      out.push({ id: layer, kind: state, layer, text });
    }
    return out;
  };

  let rendered = "";
  let previous = new Map<string, Kind>();

  /** Solo transiciones (sin minutos, para no ser ruidoso): lo que aparece, cambia o se recupera. */
  const announce = (items: Entry[]): void => {
    const messages: string[] = [];
    for (const e of items) {
      if (previous.get(e.id) === e.kind) continue;
      if (e.kind === "reconnecting") messages.push(e.text);
      else {
        const layer = { layer: t(LAYER_KEY(e.layer as LayerId)) };
        messages.push(
          t(e.kind === "nodata" ? "status.nodata.unknown" : "status.delayed.short", layer),
        );
      }
    }
    for (const id of previous.keys()) {
      if (items.some((e) => e.id === id)) continue;
      messages.push(
        id === "net"
          ? t("status.reconnected")
          : t("status.live", { layer: t(LAYER_KEY(id as LayerId)) }),
      );
    }
    previous = new Map(items.map((e) => [e.id, e.kind]));
    if (messages.length > 0) live.textContent = messages.join(". ");
  };

  const render = (): void => {
    const items = entries();
    root.hidden = items.length === 0;
    const sig = items.map((e) => `${e.id}:${e.kind}:${e.text}`).join("|");
    if (sig !== rendered) {
      rendered = sig;
      list.replaceChildren(
        ...items.map((e) => {
          const li = document.createElement("li");
          li.className = `source-status__item source-status__item--${e.kind}`;
          const token = e.layer ? (TOKEN[e.layer] ?? e.layer) : "warn";
          li.style.setProperty("--chip", `var(--pulso-${token})`);
          const mark = document.createElement("span");
          mark.className = "source-status__mark";
          mark.setAttribute("aria-hidden", "true");
          const text = document.createElement("span");
          text.textContent = e.text;
          li.append(mark, text);
          return li;
        }),
      );
    }
    announce(items);
  };

  const unsubscribe = monitor.subscribe(render);
  const timer = setInterval(render, opts.refreshMs ?? 15_000);
  render();

  return {
    element: root,
    destroy() {
      unsubscribe();
      clearInterval(timer);
      root.remove();
    },
  };
}
