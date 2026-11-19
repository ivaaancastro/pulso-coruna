import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, type Locale } from "../../i18n";
import { air, T0 } from "../test-helpers";
import { createAirCard } from "./air-card";
import { readAir, type AirReading } from "./model";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const observations = (eaqi: number) => [
  air("eaqi", eaqi),
  air("pm25", 3.6),
  air("pm10", 10),
  air("no2", 2.6),
  air("o3", 78),
  air("so2", 0.6),
];

const reading = (eaqi = 29): AirReading => {
  const r = readAir(observations(eaqi), T0);
  if (!r) throw new Error("sin lectura");
  return r;
};

function setup(locale: Locale = "es") {
  let now = T0 + 20 * 60_000;
  const onToggle = vi.fn();
  const card = createAirCard({
    parent: document.body,
    t: createTranslator(locale),
    locale,
    now: () => now,
    onToggle,
  });
  return {
    card,
    onToggle,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const text = (node: Element, sel: string) => node.querySelector(sel)?.textContent;

describe("etiqueta «modelo»", () => {
  it("oculta sin lectura; con lectura enseña «modelo», el nivel y la atribución", () => {
    const { card } = setup();
    expect(card.badge.hidden).toBe(true);
    card.update(reading(29));
    expect(card.badge.hidden).toBe(false);
    expect(text(card.badge, ".air-badge__name")).toBe("Aire · modelo");
    expect(text(card.badge, ".air-badge__word")).toBe("Razonable");
    expect(text(card.badge, ".air-badge__attr")).toBe("Open-Meteo.com (datos CAMS)");
    expect(card.badge.getAttribute("aria-label")).toContain("modelo");
    // la escala tiene tantos segmentos rellenos como el nivel
    expect(card.badge.querySelectorAll(".air-scale__seg--on")).toHaveLength(2);
    expect(card.badge.querySelectorAll(".air-scale__seg")).toHaveLength(6);
  });

  it("la palabra del nivel sigue a los datos en es, gl y en", () => {
    const words = { es: "Muy mala", gl: "Moi mala", en: "Very poor" } as const;
    for (const locale of ["es", "gl", "en"] as const) {
      document.body.replaceChildren();
      const { card } = setup(locale);
      card.update(reading(90));
      expect(text(card.badge, ".air-badge__word")).toBe(words[locale]);
    }
  });

  it("sin lectura vuelve a ocultarse y se puede suprimir (fuente sin datos)", () => {
    const { card } = setup();
    card.update(reading());
    card.suppress(true);
    expect(card.badge.hidden).toBe(true);
    card.suppress(false);
    expect(card.badge.hidden).toBe(false);
    card.update(null);
    expect(card.badge.hidden).toBe(true);
  });
});

describe("tarjeta", () => {
  it("el botón la abre y la cierra; aria-expanded acompaña", () => {
    const { card, onToggle } = setup();
    card.update(reading());
    expect(card.panel.hidden).toBe(true);
    card.badge.click();
    expect(card.panel.hidden).toBe(false);
    expect(card.badge.getAttribute("aria-expanded")).toBe("true");
    card.badge.click();
    expect(card.panel.hidden).toBe(true);
    expect(onToggle.mock.calls).toEqual([[true], [false]]);
  });

  it("enseña EAQI con palabra, contaminantes con unidades, «no medición», antigüedad y atribución", () => {
    const { card } = setup();
    card.update(reading(29));
    card.open();
    expect(text(card.panel, ".pulso-card__title")).toBe("Calidad del aire: Razonable");
    expect(text(card.panel, ".pulso-card__kicker")).toBe("Aire");
    expect(card.panel.getAttribute("aria-label")).toBe("Calidad del aire (modelo)");
    const [eaqi] = card.panel.querySelectorAll(".pulso-card__group:first-child .pulso-card__row");
    expect(eaqi?.querySelector("dd")?.textContent).toBe("29, nivel 2 de 6");
    expect(eaqi?.querySelectorAll(".air-scale__seg--on")).toHaveLength(2);
    const notes = card.panel.querySelectorAll(".pulso-card__note");
    expect([...notes].map((n) => n.textContent)).toEqual([
      "Modelo CAMS, no medición",
      "Un solo valor para toda la ciudad (celda de unos 40 km)",
    ]);
    expect(notes[0]?.className).toContain("pulso-card__note--model");
    const stats = [
      ...card.panel.querySelectorAll(".pulso-card__group:last-child .pulso-card__row"),
    ].map((n) => [n.querySelector("dt")?.textContent, n.querySelector("dd")?.textContent]);
    expect(stats).toEqual([
      ["PM2.5", "3,6 µg/m³"],
      ["PM10", "10 µg/m³"],
      ["NO₂", "2,6 µg/m³"],
      ["O₃", "78 µg/m³"],
      ["SO₂", "0,6 µg/m³"],
    ]);
    expect(text(card.panel, ".pulso-card__updated")).toMatch(/^Actualizado hace 20 min/);
    expect(card.panel.querySelector(".pulso-card__updated")?.getAttribute("title")).toMatch(
      /^\d\d:\d\d$/,
    );
    const link = card.panel.querySelector<HTMLAnchorElement>(".pulso-card__attribution a");
    expect(link?.textContent).toBe("Open-Meteo.com (datos CAMS)");
    expect(link?.rel).toContain("noopener");
  });

  it("un contaminante ausente se muestra con raya, sin inventar valor", () => {
    const { card } = setup();
    const r = readAir([air("eaqi", 30), air("pm10", 9)], T0);
    card.update(r);
    card.open();
    const dds = [...card.panel.querySelectorAll(".pulso-card__group:last-child dd")].map(
      (n) => n.textContent,
    );
    expect(dds).toEqual(["—", "9 µg/m³", "—", "—", "—"]);
  });

  it("se refresca sola con el reloj y con los datos nuevos", () => {
    vi.useFakeTimers();
    const { card, tick } = setup();
    card.update(reading(29));
    card.open();
    expect(text(card.panel, ".pulso-card__updated")).toMatch(/20 min/);
    tick(5 * 60_000);
    vi.advanceTimersByTime(1000);
    expect(text(card.panel, ".pulso-card__updated")).toMatch(/25 min/);
    card.update(reading(70));
    expect(text(card.panel, ".pulso-card__title")).toBe("Calidad del aire: Mala");
  });

  it("Esc la cierra; deja de escuchar el teclado y el reloj al cerrarse", () => {
    vi.useFakeTimers();
    const { card, onToggle } = setup();
    card.update(reading());
    card.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(card.panel.hidden).toBe(true);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    // Sin intervalo vivo: los pendientes (p. ej. de jsdom al dar foco) se agotan solos.
    vi.advanceTimersByTime(10_000);
    expect(vi.getTimerCount()).toBe(0);
    card.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(card.panel.hidden).toBe(false);
  });

  it("se cierra si la fuente queda sin datos o desaparece la lectura", () => {
    const { card } = setup();
    card.update(reading());
    card.open();
    card.suppress(true);
    expect(card.panel.hidden).toBe(true);
    card.suppress(false);
    card.open();
    card.update(null);
    expect(card.panel.hidden).toBe(true);
  });

  it("no se abre sin lectura", () => {
    const { card } = setup();
    card.toggle();
    card.open();
    expect(card.panel.hidden).toBe(true);
  });

  it("el nivel peor cambia la escala (más segmentos) y la palabra", () => {
    const { card } = setup();
    card.update(reading(150));
    expect(card.badge.querySelectorAll(".air-scale__seg--on")).toHaveLength(6);
    expect(text(card.badge, ".air-badge__word")).toBe("Extremadamente mala");
  });
});
