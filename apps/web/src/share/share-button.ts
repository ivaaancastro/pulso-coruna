import type { Translate } from "../i18n";

export interface ShareButtonOptions {
  t: Translate;
  /** Enlace canónico de la vista actual, calculado en el momento del clic. */
  getUrl(): string;
  nav?: Pick<Navigator, "share" | "clipboard">;
  /** `share` nativo solo en táctil: en escritorio abriría una hoja de compartir en vez de copiar. */
  preferNativeShare?: boolean;
  /** Cuánto dura el mensaje, ms. */
  messageMs?: number;
}

export interface ShareButton {
  element: HTMLElement;
  /** Comparte o copia; resuelve cuando termina (para tests). */
  activate(): Promise<void>;
}

export const MESSAGE_MS = 2600;

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7h14v-7" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Botón discreto «Compartir enlace» (M6.4). `navigator.share` si existe (móvil), si no el portapapeles;
 * el resultado se anuncia en una región `aria-live` que también se ve unos segundos.
 */
export function createShareButton(opts: ShareButtonOptions): ShareButton {
  const nav = opts.nav ?? navigator;
  const preferNative =
    opts.preferNativeShare ??
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);

  const root = document.createElement("div");
  root.className = "share";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "share__button";
  button.setAttribute("aria-label", opts.t("share.label"));
  button.title = opts.t("share.label");
  button.innerHTML = ICON; // constante propia, sin datos externos

  const message = document.createElement("p");
  message.className = "share__message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  root.append(button, message);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const say = (text: string): void => {
    if (timer) clearTimeout(timer);
    message.textContent = text;
    message.dataset["visible"] = "true";
    timer = setTimeout(() => {
      message.textContent = "";
      delete message.dataset["visible"];
    }, opts.messageMs ?? MESSAGE_MS);
  };

  async function activate(): Promise<void> {
    const url = opts.getUrl();
    if (preferNative && typeof nav.share === "function") {
      try {
        await nav.share({ title: opts.t("app.name"), url });
        return;
      } catch (error) {
        // El usuario cerró la hoja: no es un fallo y no se copia a escondidas.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      if (!nav.clipboard) throw new Error("sin portapapeles");
      await nav.clipboard.writeText(url);
      say(opts.t("share.copied"));
    } catch {
      say(opts.t("share.failed"));
    }
  }

  button.addEventListener("click", () => void activate());
  return { element: root, activate };
}
