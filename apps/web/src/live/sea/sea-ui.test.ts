import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, type Locale } from "../../i18n";
import { T0 } from "../test-helpers";
import type { SeaView } from "./model";
import { createSeaUi } from "./sea-ui";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(initial: SeaView | null, locale: Locale = "es") {
  let view = initial;
  let now = T0 + 120_000;
  const onOpenChange = vi.fn();
  const ui = createSeaUi({
    chipParent: document.body,
    cardParent: document.body,
    t: createTranslator(locale),
    locale,
    now: () => now,
    read: () => view,
    onOpenChange,
  });
  return {
    ui,
    onOpenChange,
    set: (v: SeaView | null) => {
      view = v;
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const rising: SeaView = { value: 3.507, ts: T0, fraction: 0.8, trend: "rising" };
const text = (el: Element, sel: string) => el.querySelector(sel)?.textContent;

describe("indicador y tarjeta de la marea", () => {
  it("sin datos no se ve nada", () => {
    const { ui } = setup(null);
    ui.update();
    expect(ui.chip.hidden).toBe(true);
    expect(ui.card.hidden).toBe(true);
    ui.setOpen(true);
    expect(ui.open).toBe(false);
  });

  it("el indicador dice el nivel y la tendencia (es, con coma decimal)", () => {
    const { ui } = setup(rising);
    ui.update();
    expect(ui.chip.hidden).toBe(false);
    expect(text(ui.chip, ".sea-chip__text")).toBe("Marea 3,51 m · Sube");
    expect(ui.chip.getAttribute("aria-expanded")).toBe("false");
    expect(ui.chip.querySelector("svg")).not.toBeNull();
  });

  it("sin tendencia conocida no la muestra en el indicador", () => {
    const { ui } = setup({ ...rising, trend: null });
    ui.update();
    expect(text(ui.chip, ".sea-chip__text")).toBe("Marea 3,51 m");
    ui.setOpen(true);
    expect(text(ui.card, ".sea-card__trend")).toBe("Tendencia aún sin determinar");
  });

  it("la tarjeta enseña nivel, tendencia, antigüedad, cero y atribución", () => {
    const { ui, onOpenChange } = setup(rising);
    ui.update();
    ui.chip.click();
    expect(ui.open).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(ui.card.hidden).toBe(false);
    expect(ui.chip.getAttribute("aria-expanded")).toBe("true");
    const dd = [...ui.card.querySelectorAll("dd")].map((n) => n.textContent);
    expect(dd).toEqual(["3,51 m", "Sube"]);
    expect(text(ui.card, ".sea-card__updated")).toMatch(/^Actualizado hace 2 min/);
    expect(ui.card.textContent).toContain("Fuente: Puertos del Estado (Portus)");
    expect(ui.card.textContent).toContain("Respecto al cero del mareógrafo");
  });

  it("se refresca con el reloj y con lecturas nuevas", () => {
    vi.useFakeTimers();
    const { ui, set, tick } = setup(rising);
    ui.update();
    ui.setOpen(true);
    tick(180_000);
    vi.advanceTimersByTime(1000);
    expect(text(ui.card, ".sea-card__updated")).toMatch(/hace 5 min/);
    set({ ...rising, value: 2.1, trend: "falling" });
    vi.advanceTimersByTime(1000);
    expect(text(ui.chip, ".sea-chip__text")).toBe("Marea 2,10 m · Baja");
  });

  it("cierra con el botón, con Esc y al perder los datos", () => {
    const { ui, set, onOpenChange } = setup(rising);
    ui.update();
    ui.setOpen(true);
    ui.card.querySelector<HTMLButtonElement>(".sea-card__close")?.click();
    expect(ui.open).toBe(false);
    ui.setOpen(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ui.open).toBe(false);
    ui.setOpen(true);
    set(null);
    ui.update();
    expect(ui.open).toBe(false);
    expect(ui.chip.hidden).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("está traducido a gallego e inglés", () => {
    const gl = setup(rising, "gl");
    gl.ui.update();
    expect(text(gl.ui.chip, ".sea-chip__text")).toBe("Marea 3,51 m · Sobe");
    document.body.replaceChildren();
    const en = setup(rising, "en");
    en.ui.update();
    expect(text(en.ui.chip, ".sea-chip__text")).toBe("Tide 3.51 m · Rising");
  });

  it("destroy retira el DOM", () => {
    const { ui } = setup(rising);
    ui.destroy();
    expect(document.body.children).toHaveLength(0);
  });
});
