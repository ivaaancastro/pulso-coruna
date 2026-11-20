import type { MessageKey, Translate } from "../i18n";

export type Mode = "view" | "replay";

/** «Ahora» (M2.4, id interno `view`) y «Reproducir» (M6.3). «Escuchar» (M7.1) no es un modo: es un interruptor. */
export const MODES: readonly Mode[] = ["view", "replay"];

const LABEL_KEY: Record<Mode, MessageKey> = {
  view: "mode.view",
  replay: "mode.replay",
};

/** Altavoz con ondas; decorativo (el nombre accesible es el texto del botón). */
const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="listen__waves" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

export interface ModeSelector {
  /** Barra con los modos (radiogroup) y el interruptor «Escuchar». */
  element: HTMLElement;
  /** Anuncios accesibles (aria-live), separados del grupo. */
  status: HTMLElement;
  getMode(): Mode;
  /** Devuelve false si el modo aún no está disponible (no cambia la selección). */
  select(mode: Mode): boolean;
  /** ¿Está activado «Escuchar»? (solo de sesión; apagado al cargar). */
  isListening(): boolean;
  /** Pone «Escuchar» en un estado sin disparar `onListen` (p. ej. si el navegador no puede). */
  setListening(on: boolean): void;
}

/**
 * Activar/desactivar el sonido. Se llama dentro del gesto del usuario (síncrono hasta crear el
 * `AudioContext`); devuelve `false` si no se pudo activar y el botón vuelve a apagado.
 */
export type ListenHandler = (on: boolean) => boolean | Promise<boolean>;

export function createModeSelector(
  t: Translate,
  onChange: (mode: Mode) => void = () => undefined,
  onListen: ListenHandler = () => false,
): ModeSelector {
  let current: Mode = "view";
  let listening = false;

  const group = document.createElement("div");
  group.className = "modes";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", t("mode.label"));

  const bar = document.createElement("div");
  bar.className = "modes-bar";

  const status = document.createElement("p");
  status.className = "sr-only";
  status.setAttribute("role", "status");

  const buttons = new Map<Mode, HTMLButtonElement>();

  const paint = (focusable: Mode): void => {
    for (const [mode, button] of buttons) {
      button.setAttribute("aria-checked", String(mode === current));
      button.tabIndex = mode === focusable ? 0 : -1;
    }
  };

  const select = (mode: Mode): boolean => {
    const name = t(LABEL_KEY[mode]);
    if (mode !== current) {
      current = mode;
      onChange(mode);
    }
    status.textContent = t("mode.selected", { mode: name });
    paint(mode);
    return true;
  };

  for (const mode of MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "modes__option";
    button.dataset["mode"] = mode;
    button.setAttribute("role", "radio");
    const name = document.createElement("span");
    name.className = "modes__name";
    name.textContent = t(LABEL_KEY[mode]);
    button.append(name);

    button.addEventListener("click", () => select(mode));
    button.addEventListener("focus", () => paint(mode));
    buttons.set(mode, button);
    group.append(button);
  }

  group.addEventListener("keydown", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]");
    if (!target) return;
    const index = MODES.indexOf(target.dataset["mode"] as Mode);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    const mode = MODES[next];
    if (!mode) return;
    // Patrón radio (APG): la flecha mueve el foco y marca la opción; la tabulación no se queda en
    // un radio sin marcar.
    buttons.get(mode)?.focus();
    select(mode);
  });

  const listen = document.createElement("button");
  listen.type = "button";
  listen.className = "listen";
  listen.dataset["listen"] = "";
  listen.setAttribute("aria-pressed", "false");
  const icon = document.createElement("span");
  icon.className = "listen__icon";
  icon.innerHTML = SPEAKER_SVG;
  const label = document.createElement("span");
  label.className = "listen__name";
  label.textContent = t("mode.listen");
  listen.append(icon, label);

  const setListening = (on: boolean): void => {
    listening = on;
    listen.setAttribute("aria-pressed", String(on));
    listen.removeAttribute("aria-busy");
  };

  listen.addEventListener("click", () => {
    if (listen.getAttribute("aria-busy") === "true") return;
    if (listening) {
      setListening(false);
      void Promise.resolve(onListen(false)).catch(() => undefined);
      status.textContent = t("audio.off");
      return;
    }
    // El manejador debe crear el AudioContext aquí mismo (dentro del gesto).
    listen.setAttribute("aria-busy", "true");
    let result: boolean | Promise<boolean>;
    try {
      result = onListen(true);
    } catch {
      result = false;
    }
    void Promise.resolve(result)
      .catch(() => false)
      .then((ok) => {
        setListening(ok);
        status.textContent = ok ? t("audio.on") : t("audio.unavailable");
      });
  });

  bar.append(group, listen);
  paint(current);
  return {
    element: bar,
    status,
    getMode: () => current,
    select,
    isListening: () => listening,
    setListening,
  };
}
