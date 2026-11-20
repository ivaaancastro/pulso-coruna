import { describe, expect, it } from "vitest";
import { hideDeckCanvas, watchDeckCanvas } from "./deck-a11y";

function mapWithDeck(): { root: HTMLElement; widget: HTMLElement } {
  const root = document.createElement("div");
  const widget = document.createElement("div");
  widget.className = "deck-widget-container";
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  widget.append(canvas);
  root.append(widget);
  return { root, widget };
}

describe("canvas de deck.gl fuera del teclado", () => {
  it("quita el canvas del orden de tabulación y del árbol de accesibilidad", () => {
    const { root } = mapWithDeck();
    expect(hideDeckCanvas(root)).toBe(1);
    const canvas = root.querySelector("canvas");
    expect(canvas?.tabIndex).toBe(-1);
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("no depende solo de .deck-widget-container (.deck-canvas también)", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "deck-canvas";
    canvas.tabIndex = 0;
    root.append(canvas);
    expect(hideDeckCanvas(root)).toBe(1);
    expect(canvas.tabIndex).toBe(-1);
  });

  it("no toca el canvas de MapLibre", () => {
    const { root } = mapWithDeck();
    const mapCanvas = document.createElement("canvas");
    mapCanvas.className = "maplibregl-canvas";
    mapCanvas.tabIndex = 0;
    root.prepend(mapCanvas);
    hideDeckCanvas(root);
    expect(mapCanvas.tabIndex).toBe(0);
    expect(mapCanvas.hasAttribute("aria-hidden")).toBe(false);
  });

  it("se reaplica si deck.gl recrea el canvas y se detiene al limpiar", async () => {
    const { root, widget } = mapWithDeck();
    const stop = watchDeckCanvas(root);
    const fresh = document.createElement("canvas");
    fresh.tabIndex = 0;
    widget.replaceChildren(fresh);
    await Promise.resolve();
    expect(fresh.tabIndex).toBe(-1);
    expect(fresh.getAttribute("aria-hidden")).toBe("true");

    stop();
    const later = document.createElement("canvas");
    later.tabIndex = 0;
    widget.append(later);
    await Promise.resolve();
    expect(later.tabIndex).toBe(0);
  });
});
