import type { Locale, Translate } from "../i18n";
import { createCreditsPanel, type CreditsPanel } from "./credits";
import type { StatusHandle } from "./start";

export interface CreditsLinkOptions {
  t: Translate;
  locale: Locale;
  /** URL del stream de nuestra API (`live/config.ts`); `null` = sin API: el panel solo muestra créditos. */
  streamUrl: string | null;
  /** Para pruebas: cargador del chunk de estado. */
  loadStatus?: () => Promise<typeof import("./start")>;
}

/**
 * Enlace discreto «Estado y créditos» (M8.4). El panel se crea al primer clic y abre al instante con
 * los créditos (JS inicial, sin red); el estado por fuente es un chunk diferido (`status/start.ts`)
 * que se descarga en ese mismo momento y consulta nuestra API cada vez que se abre.
 */
export function createCreditsLink(opts: CreditsLinkOptions): HTMLButtonElement {
  const { t, streamUrl } = opts;
  const loadStatus = opts.loadStatus ?? (() => import("./start"));
  let panel: CreditsPanel | null = null;
  let status: Promise<StatusHandle> | null = null;

  const refresh = (): void => {
    if (!streamUrl) return;
    status ??= loadStatus().then((m) => m.startStatus({ panel: panel as CreditsPanel, streamUrl }));
    status
      .then((handle) => handle.refresh())
      .catch((error: unknown) => {
        console.error("[status] no se pudo consultar", error);
        status = null;
        panel?.update({ kind: "error" });
      });
  };

  const button = document.createElement("button");
  button.type = "button";
  button.className = "credits-link";
  button.textContent = t("credits.link");
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", () => {
    panel ??= createCreditsPanel({
      t,
      locale: opts.locale,
      noApi: streamUrl === null,
      onOpen: refresh,
      onRetry: refresh,
      onClose: () => void status?.then((handle) => handle.cancel()),
    });
    panel.open();
  });
  return button;
}
