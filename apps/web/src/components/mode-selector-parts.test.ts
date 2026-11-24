import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createModeSelector } from "./mode-selector";

const t = createTranslator("es");

describe("partes opcionales (v1 simple)", () => {
  it("sin modos solo queda el interruptor Escuchar", () => {
    const selector = createModeSelector(t, vi.fn(), () => true, { modes: false });
    expect(selector.element.querySelector("[data-mode]")).toBeNull();
    expect(selector.element.querySelector("[data-listen]")).not.toBeNull();
  });

  it("sin Escuchar solo quedan los modos", () => {
    const selector = createModeSelector(t, vi.fn(), () => true, { listen: false });
    expect(selector.element.querySelector("[data-mode]")).not.toBeNull();
    expect(selector.element.querySelector("[data-listen]")).toBeNull();
  });
});
