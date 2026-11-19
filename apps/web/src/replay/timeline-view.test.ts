import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { addMadridDays, madridDayStart } from "../time/day";
import { KEY_STEPS, createTimelineView, keyboardTarget, type TimelineModel } from "./timeline-view";

const DAY = madridDayStart(Date.parse("2026-11-18T12:00:00Z"));
const END = addMadridDays(DAY, 1);
const model = (over: Partial<TimelineModel> = {}): TimelineModel => ({
  t: DAY + 14 * 3_600_000 + 32 * 60_000,
  dayStart: DAY,
  dayEnd: END,
  limit: END,
  playing: false,
  speed: 60,
  status: { kind: "none", text: "" },
  ...over,
});

function setup() {
  const handlers = {
    onSeek: vi.fn(),
    onScrubStart: vi.fn(),
    onScrubEnd: vi.fn(),
    onToggle: vi.fn(),
    onSpeed: vi.fn(),
    onDay: vi.fn(),
  };
  const view = createTimelineView({
    t: createTranslator("es"),
    locale: "es",
    days: [END, DAY],
    today: END,
    handlers,
  });
  document.body.replaceChildren(view.element);
  view.update(model());
  const track = view.element.querySelector<HTMLElement>('[role="slider"]') as HTMLElement;
  return { view, handlers, track };
}
const key = (el: HTMLElement, k: string, shiftKey = false) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }),
  );

describe("keyboardTarget", () => {
  const t = DAY + 10 * 3_600_000;
  it("flechas ±1 min, con Mayús ±5 min, AvPág/RePág ±1 h, Inicio/Fin", () => {
    expect(keyboardTarget("ArrowRight", false, t, DAY, END)).toBe(t + KEY_STEPS.fine);
    expect(keyboardTarget("ArrowLeft", false, t, DAY, END)).toBe(t - KEY_STEPS.fine);
    expect(keyboardTarget("ArrowRight", true, t, DAY, END)).toBe(t + KEY_STEPS.coarse);
    expect(keyboardTarget("ArrowDown", true, t, DAY, END)).toBe(t - KEY_STEPS.coarse);
    expect(keyboardTarget("PageUp", false, t, DAY, END)).toBe(t + KEY_STEPS.page);
    expect(keyboardTarget("Home", false, t, DAY, END)).toBe(DAY);
    expect(keyboardTarget("End", false, t, DAY, END)).toBe(END);
    expect(keyboardTarget("a", false, t, DAY, END)).toBeNull();
  });
  it("respeta los extremos y el límite (hoy no pasa de «ahora»)", () => {
    expect(keyboardTarget("ArrowLeft", false, DAY + 1000, DAY, END)).toBe(DAY);
    expect(keyboardTarget("ArrowRight", true, t, DAY, t + 1000)).toBe(t + 1000);
    expect(keyboardTarget("End", false, t, DAY, t + 5)).toBe(t + 5);
  });
});

describe("barra de tiempo", () => {
  beforeEach(() => document.body.replaceChildren());

  it("el cursor es un slider con valor y texto en hora de Madrid", () => {
    const { track } = setup();
    expect(track.getAttribute("aria-valuetext")).toBe("14:32");
    expect(track.getAttribute("aria-valuenow")).toBe(String(14 * 60 + 32));
    expect(track.getAttribute("aria-valuemin")).toBe("0");
    expect(track.getAttribute("aria-valuemax")).toBe("1440");
    expect(track.tabIndex).toBe(0);
  });

  it("un día de 23 h tiene 1380 minutos", () => {
    const { view, track } = setup();
    const start = madridDayStart(Date.parse("2026-03-29T10:00:00Z"));
    view.update(model({ dayStart: start, dayEnd: addMadridDays(start, 1), t: start }));
    expect(track.getAttribute("aria-valuemax")).toBe("1380");
  });

  it("teclado: flechas, Mayús, Inicio/Fin piden el instante; espacio alterna play/pausa", () => {
    const { track, handlers } = setup();
    const t = model().t;
    key(track, "ArrowRight");
    expect(handlers.onSeek).toHaveBeenLastCalledWith(t + KEY_STEPS.fine);
    key(track, "ArrowLeft", true);
    expect(handlers.onSeek).toHaveBeenLastCalledWith(t - KEY_STEPS.coarse);
    key(track, "Home");
    expect(handlers.onSeek).toHaveBeenLastCalledWith(DAY);
    key(track, " ");
    expect(handlers.onToggle).toHaveBeenCalledTimes(1);
    key(track, "x");
    expect(handlers.onSeek).toHaveBeenCalledTimes(3);
  });

  it("botón de play con nombre que refleja el estado; velocidades como radios", () => {
    const { view, handlers } = setup();
    const play = view.element.querySelector<HTMLButtonElement>(
      ".timeline__play",
    ) as HTMLButtonElement;
    expect(play.getAttribute("aria-label")).toBe("Reproducir");
    view.update(model({ playing: true }));
    expect(play.getAttribute("aria-label")).toBe("Pausar");
    play.click();
    expect(handlers.onToggle).toHaveBeenCalled();
    const radios = view.element.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect([...radios].map((r) => r.textContent)).toEqual(["1×", "60×", "600×"]);
    expect([...radios].map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    radios[2]?.click();
    expect(handlers.onSpeed).toHaveBeenCalledWith(600);
  });

  it("selector de día con «Hoy» y cambio de día", () => {
    const { view, handlers } = setup();
    const select = view.element.querySelector("select") as HTMLSelectElement;
    expect(select.options[0]?.textContent).toMatch(/^Hoy · /);
    select.value = String(DAY);
    select.dispatchEvent(new Event("change"));
    expect(handlers.onDay).toHaveBeenCalledWith(DAY);
  });

  it("arrastre: avisa al empezar y al terminar y pide el instante por la posición", () => {
    const { track, handlers } = setup();
    track.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 44 }) as DOMRect;
    const ev = (type: string, x: number) =>
      track.dispatchEvent(
        Object.assign(
          new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }),
          {
            pointerId: 1,
          },
        ),
      );
    ev("pointerdown", 500);
    expect(handlers.onScrubStart).toHaveBeenCalled();
    expect(handlers.onSeek).toHaveBeenLastCalledWith(DAY + (END - DAY) / 2);
    ev("pointermove", 250);
    expect(handlers.onSeek).toHaveBeenLastCalledWith(DAY + (END - DAY) / 4);
    ev("pointerup", 250);
    expect(handlers.onScrubEnd).toHaveBeenCalledTimes(1);
    ev("pointermove", 900);
    expect(handlers.onSeek).toHaveBeenCalledTimes(2); // sin arrastre no sigue
  });

  it("mensaje de estado visible solo cuando hay algo que decir", () => {
    const { view } = setup();
    const status = view.element.querySelector(".timeline__status") as HTMLElement;
    expect(status.hidden).toBe(true);
    view.update(model({ status: { kind: "nodata", text: "Sin datos" } }));
    expect(status.hidden).toBe(false);
    expect(status.dataset["kind"]).toBe("nodata");
    view.update(model({ status: { kind: "loading", text: "Cargando" } }));
    expect(view.element.dataset["loading"]).toBe("true");
  });
});
