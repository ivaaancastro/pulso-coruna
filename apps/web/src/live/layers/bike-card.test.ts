import type { StationStatus } from "@pulso/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../i18n";
import { station, T0 } from "../test-helpers";
import { createBikeCard } from "./bike-card";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(initial: StationStatus = station("12", { bikes: 7, docks: 13 })) {
  let current: StationStatus | undefined = initial;
  let now = T0 + 120_000;
  const onClose = vi.fn();
  const card = createBikeCard({
    parent: document.body,
    t: createTranslator("es"),
    locale: "es",
    now: () => now,
    read: () => current,
    onClose,
  });
  return {
    card,
    onClose,
    set: (s: StationStatus | undefined) => {
      current = s;
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const text = (card: { element: HTMLElement }, sel: string) =>
  card.element.querySelector(sel)?.textContent;
const values = (card: { element: HTMLElement }) =>
  [...card.element.querySelectorAll("dd")].map((n) => n.textContent);

describe("tarjeta de estación", () => {
  it("oculta hasta que se muestra; enseña id, bicis, huecos y antigüedad", () => {
    const { card } = setup();
    expect(card.element.hidden).toBe(true);
    card.show("12");
    expect(card.element.hidden).toBe(false);
    expect(text(card, ".pulso-card__title")).toBe("Estación 12");
    expect(values(card)).toEqual(["7", "13"]);
    expect(text(card, ".pulso-card__updated")).toMatch(/^Actualizado hace 2 min/);
    expect(card.element.querySelector(".pulso-card__updated")?.getAttribute("title")).toMatch(
      /^\d\d:\d\d$/,
    );
    expect(card.element.querySelector(".pulso-card__note--state")).toBeNull();
    expect(card.element.getAttribute("role")).toBe("dialog");
    expect(text(card, ".pulso-card__kicker")).toBe("BiciCoruña");
  });

  it("describe con texto vacía, llena y fuera de servicio", () => {
    const { card, set } = setup();
    set(station("12", { bikes: 0, docks: 20 }));
    card.show("12");
    expect(text(card, ".pulso-card__note--state")).toBe("Vacía: no quedan bicis");
    set(station("12", { bikes: 20, docks: 0 }));
    card.show("12");
    expect(text(card, ".pulso-card__note--state")).toBe("Llena: no quedan huecos");
    set(station("12", { bikes: 0, docks: 0 }));
    card.show("12");
    expect(text(card, ".pulso-card__note--state")).toBe("Sin servicio");
  });

  it("se refresca sola con el reloj y con los datos nuevos", () => {
    vi.useFakeTimers();
    const { card, set, tick } = setup();
    card.show("12");
    tick(60_000);
    set(station("12", { bikes: 3, docks: 17, ts: T0 + 60_000 }));
    vi.advanceTimersByTime(1000);
    expect(text(card, ".pulso-card__updated")).toMatch(/hace 2 min/);
    expect(values(card)).toEqual(["3", "17"]);
  });

  it("se cierra con el botón y con Esc, avisando una vez", () => {
    const { card, onClose } = setup();
    card.show("12");
    card.element.querySelector<HTMLButtonElement>(".pulso-card__close")?.click();
    expect(card.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    card.show("12");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(card.selected).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("si la estación desaparece, se oculta y avisa", () => {
    vi.useFakeTimers();
    const { card, set, onClose } = setup();
    card.show("12");
    set(undefined);
    vi.advanceTimersByTime(1000);
    expect(card.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
