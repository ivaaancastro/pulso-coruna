import type { MessageKey, Translate } from "../i18n";
import "./clip.css";
import { CLIP_DURATION_MS, type ClipContext, type ClipProgress, type ClipSession } from "./types";

export interface ClipButtonOptions {
  t: Translate;
  /** Mapa y deck.gl para grabar; `null` mientras el mapa no esté listo. */
  context(): ClipContext | null;
  /** Cargador del motor (chunk diferido). */
  load?: () => Promise<{
    startClip(ctx: ClipContext, onProgress: (p: ClipProgress) => void): ClipSession;
  }>;
  /** ¿Puede este navegador grabar un lienzo? Por defecto se comprueba `captureStream` + `MediaRecorder`. */
  supported?: boolean;
  messageMs?: number;
}

export interface ClipButton {
  element: HTMLElement;
  /** Cancela la grabación en curso (no hace nada si no hay). */
  cancel(): void;
  /** Pulsación programática; resuelve cuando termina el clip (tests). */
  activate(): Promise<void>;
}

export const CLIP_MESSAGE_MS = 3200;

export const canRecordCanvas = (): boolean =>
  typeof MediaRecorder === "function" &&
  typeof HTMLCanvasElement !== "undefined" &&
  typeof HTMLCanvasElement.prototype.captureStream === "function";

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<rect x="8" y="3" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<circle class="clip__dot" cx="12" cy="12" r="2.6" fill="currentColor"/></svg>';

const ERROR_KEY: Record<string, MessageKey> = { unsupported: "clip.unsupported" };

/**
 * Botón «Grabar clip» (M8.5). Solo el botón vive en el JS inicial; el motor (composición, MediaRecorder,
 * descarga) es un `import()` al primer clic. Mientras graba, el mismo botón cancela (también `Escape`);
 * una región `role="status"` anuncia solo inicio, fin y errores, y la barra de progreso avanza por segundos.
 */
export function createClipButton(opts: ClipButtonOptions): ClipButton {
  const { t } = opts;
  const load = opts.load ?? (() => import("./engine"));
  const supported = opts.supported ?? canRecordCanvas();

  const root = document.createElement("div");
  root.className = "clip";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "clip__button";
  button.innerHTML = ICON; // constante propia, sin datos externos

  const progress = document.createElement("progress");
  progress.className = "clip__progress";
  progress.max = CLIP_DURATION_MS / 1000;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute("aria-label", t("clip.progress.label"));

  const message = document.createElement("p");
  message.className = "clip__message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  root.append(button, progress, message);

  let session: ClipSession | null = null;
  let abort = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const say = (text: string, sticky = false): void => {
    if (timer) clearTimeout(timer);
    message.textContent = text;
    message.dataset["visible"] = "true";
    if (sticky) return;
    timer = setTimeout(() => {
      message.textContent = "";
      delete message.dataset["visible"];
    }, opts.messageMs ?? CLIP_MESSAGE_MS);
  };

  const setIdle = (): void => {
    session = null;
    root.dataset["state"] = "idle";
    progress.hidden = true;
    progress.value = 0;
    progress.removeAttribute("aria-valuetext");
    button.removeAttribute("aria-disabled");
    const label = t(supported ? "clip.label" : "clip.unsupported");
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  const setBusy = (label: string, disabled: boolean): void => {
    button.setAttribute("aria-label", label);
    button.title = label;
    if (disabled) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  };

  const onProgress = (p: ClipProgress): void => {
    root.dataset["state"] = p.phase;
    if (p.phase === "finishing") {
      setBusy(t("clip.preparing"), true);
      progress.value = progress.max;
      say(t("clip.preparing"), true);
      return;
    }
    if (p.phase === "recording") {
      const s = Math.floor(p.elapsedMs / 1000); // por segundos: sin animación continua
      if (progress.hidden) {
        progress.hidden = false;
        setBusy(t("clip.cancel"), false);
        say(t("clip.started", { total: String(p.durationMs / 1000) }));
      }
      progress.value = s;
      progress.setAttribute(
        "aria-valuetext",
        t("clip.progress", { s: String(s), total: String(p.durationMs / 1000) }),
      );
    }
  };

  const active = (): boolean => ["starting", "recording"].includes(root.dataset["state"] ?? "");

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && active()) cancel();
  };

  function cancel(): void {
    if (!active()) return;
    abort = true;
    session?.cancel();
  }

  async function start(): Promise<void> {
    if (!supported) {
      say(t("clip.unsupported"));
      return;
    }
    const ctx = opts.context();
    if (!ctx) {
      say(t("clip.nomap"));
      return;
    }
    abort = false;
    root.dataset["state"] = "starting";
    setBusy(t("clip.cancel"), false);
    say(t("clip.loading"), true);
    document.addEventListener("keydown", onKey);
    try {
      const engine = await load();
      if (abort) {
        say(t("clip.cancelled"));
        return;
      }
      session = engine.startClip(ctx, onProgress);
      const outcome = await session.done;
      if (outcome.kind === "done") say(t("clip.done"));
      else say(t(outcome.reason === "hidden" ? "clip.hidden" : "clip.cancelled"));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      console.error("[clip] fallo", error);
      say(t(ERROR_KEY[code] ?? "clip.error"));
    } finally {
      document.removeEventListener("keydown", onKey);
      setIdle();
    }
  }

  button.addEventListener("click", () => {
    if (!supported) say(t("clip.unsupported"));
    else if (active()) cancel();
    else if (root.dataset["state"] !== "finishing") void start();
  });

  setIdle();
  if (!supported) button.setAttribute("aria-disabled", "true");
  return { element: root, cancel, activate: start };
}
