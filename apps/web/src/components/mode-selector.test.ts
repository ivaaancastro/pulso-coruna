import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createModeSelector } from "./mode-selector";

const t = createTranslator("es");

function setup() {
  const onChange = vi.fn();
  const selector = createModeSelector(t, onChange);
  document.body.replaceChildren(selector.element, selector.status);
  const option = (mode: string): HTMLButtonElement => {
    const el = selector.element.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`);
    if (!el) throw new Error(mode);
    return el;
  };
  return { selector, onChange, option };
}

const key = (el: HTMLElement, name: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

describe("selector de modo", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("roles ARIA: radiogroup con tres radios, «Ver» marcado", () => {
    const { selector, option } = setup();
    expect(selector.element.getAttribute("role")).toBe("radiogroup");
    expect(selector.element.getAttribute("aria-label")).toBe("Modo de visualización");
    expect(selector.element.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(option("view").getAttribute("aria-checked")).toBe("true");
    expect(option("replay").getAttribute("aria-checked")).toBe("false");
  });

  it("Reproducir y Escuchar están marcados como próximamente y no cambian el modo", () => {
    const { selector, onChange, option } = setup();
    for (const mode of ["replay", "listen"]) {
      expect(option(mode).getAttribute("aria-disabled")).toBe("true");
      expect(option(mode).textContent).toContain("Próximamente");
      option(mode).click();
    }
    expect(selector.getMode()).toBe("view");
    expect(onChange).not.toHaveBeenCalled();
    expect(selector.status.textContent).toBe("Escuchar estará disponible próximamente.");
  });

  it("roving tabindex: solo un radio en el orden de tabulación", () => {
    const { option } = setup();
    expect(option("view").tabIndex).toBe(0);
    expect(option("replay").tabIndex).toBe(-1);
    expect(option("listen").tabIndex).toBe(-1);
  });

  it("flechas, Inicio y Fin mueven el foco (cíclico) y siguen siendo focusables", () => {
    const { option } = setup();
    option("view").focus();
    key(option("view"), "ArrowRight");
    expect(document.activeElement).toBe(option("replay"));
    expect(option("replay").tabIndex).toBe(0);
    key(option("replay"), "End");
    expect(document.activeElement).toBe(option("listen"));
    key(option("listen"), "ArrowRight");
    expect(document.activeElement).toBe(option("view"));
    key(option("view"), "ArrowLeft");
    expect(document.activeElement).toBe(option("listen"));
    key(option("listen"), "Home");
    expect(document.activeElement).toBe(option("view"));
  });

  it("seleccionar el modo ya activo anuncia sin disparar onChange", () => {
    const { selector, onChange, option } = setup();
    option("view").click();
    expect(selector.status.textContent).toBe("Modo Ver activo.");
    expect(onChange).not.toHaveBeenCalled();
  });
});
