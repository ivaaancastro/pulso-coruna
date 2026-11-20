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

  it("roles ARIA: radiogroup con dos radios («Ahora» marcado) y un interruptor aparte", () => {
    const { selector, option } = setup();
    const group = selector.element.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Modo de visualización");
    expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(group?.querySelector("[data-listen]")).toBeNull();
    expect(option("view").getAttribute("aria-checked")).toBe("true");
    expect(option("replay").getAttribute("aria-checked")).toBe("false");
  });

  it("Reproducir cambia el modo, avisa y se puede volver a Ahora", () => {
    const { selector, onChange, option } = setup();
    option("replay").click();
    expect(selector.getMode()).toBe("replay");
    expect(onChange).toHaveBeenLastCalledWith("replay");
    expect(option("replay").getAttribute("aria-checked")).toBe("true");
    expect(selector.status.textContent).toBe("Modo Reproducir activo.");
    expect(selector.select("view")).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("view");
    expect(option("view").getAttribute("aria-checked")).toBe("true");
  });

  it("roving tabindex: solo un radio en el orden de tabulación", () => {
    const { option } = setup();
    expect(option("view").tabIndex).toBe(0);
    expect(option("replay").tabIndex).toBe(-1);
  });

  it("flechas, Inicio y Fin mueven el foco (cíclico) y marcan la opción (patrón radio)", () => {
    const { option, selector } = setup();
    option("view").focus();
    key(option("view"), "ArrowRight");
    expect(document.activeElement).toBe(option("replay"));
    expect(option("replay").tabIndex).toBe(0);
    expect(option("replay").getAttribute("aria-checked")).toBe("true");
    expect(option("view").tabIndex).toBe(-1);
    expect(selector.getMode()).toBe("replay");
    key(option("replay"), "ArrowRight");
    expect(document.activeElement).toBe(option("view"));
    key(option("view"), "ArrowLeft");
    expect(document.activeElement).toBe(option("replay"));
    key(option("replay"), "Home");
    expect(document.activeElement).toBe(option("view"));
    key(option("view"), "End");
    expect(document.activeElement).toBe(option("replay"));
  });

  it("seleccionar el modo ya activo anuncia sin disparar onChange", () => {
    const { selector, onChange, option } = setup();
    option("view").click();
    expect(selector.status.textContent).toBe("Modo Ahora activo.");
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("Escuchar", () => {
    const listenButton = (): HTMLButtonElement => {
      const el = document.querySelector<HTMLButtonElement>("[data-listen]");
      if (!el) throw new Error("sin botón");
      return el;
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("nace apagado, con nombre y aria-pressed, y no es un modo", () => {
      const onListen = vi.fn(() => true);
      const selector = createModeSelector(t, vi.fn(), onListen);
      document.body.replaceChildren(selector.element, selector.status);
      expect(listenButton().textContent).toContain("Escuchar");
      expect(listenButton().getAttribute("aria-pressed")).toBe("false");
      expect(listenButton().tagName).toBe("BUTTON");
      expect(selector.isListening()).toBe(false);
      expect(onListen).not.toHaveBeenCalled();
    });

    it("el clic activa (gesto) y vuelve a apagar; anuncia el estado", async () => {
      const onListen = vi.fn(() => true);
      const selector = createModeSelector(t, vi.fn(), onListen);
      document.body.replaceChildren(selector.element, selector.status);
      listenButton().click();
      expect(onListen).toHaveBeenLastCalledWith(true);
      await flush();
      expect(listenButton().getAttribute("aria-pressed")).toBe("true");
      expect(selector.status.textContent).toBe("Sonido activado.");
      listenButton().click();
      expect(onListen).toHaveBeenLastCalledWith(false);
      expect(listenButton().getAttribute("aria-pressed")).toBe("false");
      expect(selector.status.textContent).toBe("Sonido desactivado.");
    });

    it("si no se puede activar, vuelve a apagado y lo dice", async () => {
      const selector = createModeSelector(t, vi.fn(), () => Promise.resolve(false));
      document.body.replaceChildren(selector.element, selector.status);
      listenButton().click();
      expect(listenButton().getAttribute("aria-busy")).toBe("true");
      await flush();
      expect(listenButton().getAttribute("aria-pressed")).toBe("false");
      expect(listenButton().hasAttribute("aria-busy")).toBe(false);
      expect(selector.status.textContent).toBe("No se pudo activar el sonido en este dispositivo.");
    });

    it("no depende del modo: cambiar de modo no lo apaga", async () => {
      const selector = createModeSelector(t, vi.fn(), () => true);
      document.body.replaceChildren(selector.element, selector.status);
      listenButton().click();
      await flush();
      selector.select("replay");
      expect(selector.isListening()).toBe(true);
      expect(listenButton().getAttribute("aria-pressed")).toBe("true");
    });
  });
});
