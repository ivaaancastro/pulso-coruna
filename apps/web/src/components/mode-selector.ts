import type { MessageKey, Translate } from "../i18n";

export type Mode = "view" | "replay" | "listen";

export const MODES: readonly Mode[] = ["view", "replay", "listen"];
/** Solo «Ver» tiene funcionalidad en M2.4. */
export const AVAILABLE_MODES: ReadonlySet<Mode> = new Set<Mode>(["view"]);

const LABEL_KEY: Record<Mode, MessageKey> = {
  view: "mode.view",
  replay: "mode.replay",
  listen: "mode.listen",
};

export interface ModeSelector {
  element: HTMLElement;
  /** Anuncios accesibles (aria-live), separados del grupo. */
  status: HTMLElement;
  getMode(): Mode;
  /** Devuelve false si el modo aún no está disponible (no cambia la selección). */
  select(mode: Mode): boolean;
}

export function createModeSelector(
  t: Translate,
  onChange: (mode: Mode) => void = () => undefined,
): ModeSelector {
  let current: Mode = "view";

  const group = document.createElement("div");
  group.className = "modes";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", t("mode.label"));

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
    if (!AVAILABLE_MODES.has(mode)) {
      status.textContent = t("mode.unavailable", { mode: name });
      return false;
    }
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
    const soon = !AVAILABLE_MODES.has(mode);
    if (soon) button.setAttribute("aria-disabled", "true");

    const name = document.createElement("span");
    name.className = "modes__name";
    name.textContent = t(LABEL_KEY[mode]);
    button.append(name);
    if (soon) {
      const badge = document.createElement("span");
      badge.className = "modes__soon";
      badge.textContent = t("mode.soon");
      button.append(badge);
    }

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
    if (mode) buttons.get(mode)?.focus();
  });

  paint(current);
  return { element: group, status, getMode: () => current, select };
}
