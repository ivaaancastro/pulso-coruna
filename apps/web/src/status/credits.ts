import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../i18n";
import { formatAgo } from "../time/format";
import { SOURCES, type SourceInfo } from "./sources";
import "./panel.css";

/** Estado de una fuente en el panel: el vocabulario de las capas (sin `disconnected`, que es de nuestra conexión) más dos casos propios. */
export type RowState = "live" | "delayed" | "nodata" | "inactive" | "static";

/** Estado mostrado por fila; `unknown` = aún sin consultar (cargando, error o sin API). */
type Shown = RowState | "unknown";

export interface RowStatus {
  state: RowState;
  /** Última lectura correcta (epoch ms UTC) o `null` si nunca la hubo. */
  lastSuccessAt: number | null;
}

/** Lo que el panel pinta del estado. `ready` trae una fila por fuente, en el orden de `SOURCES`. */
export type StatusView =
  | { kind: "loading" | "noapi" | "error" }
  | {
      kind: "ready";
      rows: readonly RowStatus[];
      /** Reloj del servidor (epoch ms): las edades se calculan contra él, no contra el del cliente. */
      ts: number;
      dbDown: boolean;
    };

export interface CreditsOptions {
  t: Translate;
  locale: Locale;
  /** Sin API en este entorno: solo se muestran los créditos. */
  noApi: boolean;
  /** Se abre el panel: toca (re)consultar el estado. */
  onOpen(): void;
  /** «Reintentar» tras un error. */
  onRetry(): void;
  /** Se cierra: toca cancelar lo que esté en vuelo. */
  onClose(): void;
  /** Dónde montar el diálogo (por defecto `document.body`). */
  host?: HTMLElement;
}

export interface CreditsPanel {
  element: HTMLDialogElement;
  open(): void;
  close(): void;
  update(view: StatusView): void;
  destroy(): void;
}

/**
 * Panel «Estado y créditos» (M8.4): `<dialog>` modal (foco atrapado y Escape los pone el navegador).
 * Los créditos (atribución y licencia de cada fuente, `status/sources.ts`, transcrito de `docs/sources`)
 * viven aquí, en el JS inicial: son una obligación legal y se ven al instante y sin red. El estado por
 * fuente lo trae `status/start.ts`, un chunk diferido que consulta `/api/v1/health` de nuestra API
 * (nunca de terceros) y llama a `update`.
 *
 * Los textos que se montan con `innerHTML` son del catálogo y de las traducciones del propio repo
 * (de la red solo llegan números ya formateados), por eso no se escapan.
 */
export function createCreditsPanel(opts: CreditsOptions): CreditsPanel {
  const { t } = opts;
  const intl = INTL_LOCALE[opts.locale];

  const dialog = document.createElement("dialog");
  dialog.className = "credits";
  dialog.setAttribute("aria-labelledby", "credits-title");
  dialog.innerHTML =
    `<div class="credits__sheet"><header class="credits__header">` +
    `<h2 class="credits__title" id="credits-title">${t("credits.title")}</h2>` +
    `<button type="button" class="credits__close" aria-label="${t("card.close")}">×</button></header>` +
    `<div class="credits__body"><p class="credits__intro">${t("credits.intro")}</p>` +
    `<div class="credits__notice"></div>` +
    `<h3 class="credits__section">${t("credits.sources")}</h3><ul class="credits__list"></ul>` +
    `<p class="credits__foot">${t("credits.pendingNote")}</p>` +
    `<p class="sr-only" role="status" aria-live="polite"></p></div></div>`;
  (opts.host ?? document.body).append(dialog);
  const q = <T extends Element>(sel: string): T => dialog.querySelector(sel) as T;
  const notice = q<HTMLElement>(".credits__notice");
  const list = q<HTMLElement>(".credits__list");
  const live = q<HTMLElement>("[role=status]");

  let view: StatusView = { kind: opts.noApi ? "noapi" : "loading" };
  let opener: HTMLElement | null = null;

  const link = (href: string, text: string): string =>
    `<a class="credits__link" href="${href}" target="_blank" rel="noopener noreferrer">${text}` +
    `<span class="sr-only"> ${t("credits.newTab")}</span></a>`;
  const pending = (text: string): string => `<span class="credits__pending">${text}</span>`;

  const row = (info: SourceInfo, state: Shown, lastSuccessAt: number | null): string => {
    const { license } = info;
    const read =
      view.kind === "ready" && (state === "live" || state === "delayed" || state === "nodata");
    const ago =
      view.kind === "ready" && read
        ? ` · ${
            lastSuccessAt === null
              ? t("credits.never")
              : t("credits.lastRead", { ago: formatAgo(lastSuccessAt, view.ts, intl) })
          }`
        : "";
    const pend = t("credits.license.pending");
    // Sin licencia documentada: «pendiente de confirmar». Declarada sin texto verificado: nombre + marca.
    const licence = license
      ? link(license.url, license.name) + (license.unverified ? ` ${pending(`(${pend})`)}` : "")
      : pending(pend);
    return (
      `<li class="credits__item" data-state="${state}"><div class="credits__head">` +
      `<h4 class="credits__name">${info.name}</h4><p class="credits__state">` +
      `<span class="credits__mark" aria-hidden="true"></span><span>${t(`credits.state.${state}` as MessageKey)}</span></p></div>` +
      `<p class="credits__meta">${t(`credits.use.${info.key}` as MessageKey)}${ago}</p><dl class="credits__terms">` +
      `<div><dt>${t("credits.attribution")}</dt><dd>${link(info.url, info.attribution)}</dd></div>` +
      `<div><dt>${t("credits.license")}</dt><dd>${licence}</dd></div></dl>` +
      (info.note
        ? `<p class="credits__note">${t(`credits.note.${info.key}` as MessageKey)}</p>`
        : "") +
      `</li>`
    );
  };

  const render = (): void => {
    const rows = view.kind === "ready" ? view.rows : null;
    const dbDown = view.kind === "ready" && view.dbDown;
    const message: MessageKey | null =
      view.kind === "ready" ? (dbDown ? "credits.db.down" : null) : `credits.${view.kind}`;
    notice.hidden = message === null;
    notice.className = `credits__notice${view.kind === "error" || dbDown ? " credits__notice--error" : ""}`;
    notice.innerHTML = message
      ? `<span>${t(message)}</span>` +
        (view.kind === "error"
          ? `<button type="button" class="credits__retry">${t("credits.retry")}</button>`
          : "")
      : "";
    list.innerHTML = SOURCES.map((info, i) => {
      const r = rows?.[i];
      return row(
        info,
        r ? r.state : info.healthIds.length ? "unknown" : "static",
        r?.lastSuccessAt ?? null,
      );
    }).join("");
  };

  function close(): void {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    // Clic en el fondo (fuera de la hoja), en la «×» o en «Reintentar».
    if (target === dialog || target.closest(".credits__close")) close();
    else if (target.closest(".credits__retry")) opts.onRetry();
  });
  dialog.addEventListener("close", () => {
    opts.onClose();
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus();
  });

  render();
  return {
    element: dialog,
    open() {
      if (dialog.open) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      opts.onOpen();
    },
    close,
    update(next) {
      view = next;
      if (next.kind === "ready" || next.kind === "error") {
        live.textContent = t(next.kind === "ready" ? "credits.ready" : "credits.error");
      }
      render();
    },
    destroy() {
      dialog.remove();
    },
  };
}
