import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { LiveStore } from "./live-store";
import { createSourceMonitor } from "./source-monitor";
import { DISCONNECT_GRACE_MS } from "./source-status";
import { createStatusLabel } from "./status-label";
import { T0, bus, station } from "./test-helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  document.body.replaceChildren();
});
afterEach(() => vi.useRealTimers());

function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

function setup(locale: "es" | "gl" | "en" = "es") {
  const store = new LiveStore();
  const monitor = createSourceMonitor({
    store,
    layers: ["bus", "bike"],
    now: () => Date.now(),
  });
  const label = createStatusLabel({
    parent: document.body,
    t: createTranslator(locale),
    locale,
    now: () => Date.now(),
    monitor,
  });
  monitor.start();
  store.apply({ type: "status", state: "open", attempt: 0 });
  const put = (layer: "bus" | "bike", ts: number) =>
    store.apply({
      type: "items",
      layer,
      replace: true,
      upserts: [layer === "bus" ? bus("a", { ts }) : station("s", { ts })],
      removes: [],
      receivedAt: Date.now(),
      dataTs: ts,
    });
  const lines = () => [...label.element.querySelectorAll("li")].map((li) => li.textContent);
  const announcement = () => label.element.querySelector("[role=status]")?.textContent;
  return { store, monitor, label, put, lines, announcement };
}

describe("etiqueta de estado", () => {
  it("oculta y vacía mientras todo está vivo", () => {
    const { put, label, lines } = setup();
    put("bus", T0);
    put("bike", T0);
    expect(label.element.hidden).toBe(true);
    expect(lines()).toEqual([]);
  });

  it("«Bus: sin datos desde hace 7 min» con formatAgo", () => {
    const { put, label, lines } = setup();
    put("bus", T0);
    put("bike", T0 + 7 * 60_000 - 1000);
    advance(7 * 60_000);
    expect(label.element.hidden).toBe(false);
    expect(lines()).toEqual(["Bus: sin datos desde hace 7 min"]);
  });

  it("es, gl y en", () => {
    for (const [locale, text] of [
      ["gl", "Bus: sen datos desde hai 7 min"],
      ["en", "Bus: no data, last seen 7 min ago"],
    ] as const) {
      document.body.replaceChildren();
      const { put, lines } = setup(locale);
      put("bus", Date.now());
      advance(7 * 60_000);
      expect(lines()).toEqual([text]);
    }
  });

  it("retrasado se dice distinto y el texto envejece solo", () => {
    const { put, lines } = setup();
    put("bus", T0);
    advance(90_000);
    expect(lines()).toEqual(["Bus: retrasado, último dato hace 1 min"]);
    advance(60_000);
    expect(lines()[0]).toMatch(/sin datos desde hace 2 min/);
  });

  it("capa vacía sin ninguna marca: «sin datos» sin inventar una hora", () => {
    const { store, lines } = setup();
    store.apply({
      type: "items",
      layer: "bus",
      replace: true,
      upserts: [],
      removes: [],
      receivedAt: T0,
      dataTs: 0,
    });
    expect(lines()).toEqual(["Bus: sin datos"]);
  });

  it("conexión caída: una sola línea «Reconectando…», no culpa a las fuentes", () => {
    const { store, put, lines } = setup();
    put("bus", T0);
    put("bike", T0);
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    advance(DISCONNECT_GRACE_MS - 1000);
    expect(lines()).toEqual([]);
    advance(3000);
    expect(lines()).toEqual(["Reconectando…"]);
    expect(lines().join()).not.toMatch(/sin datos/);
  });

  it("accesible: región con nombre, texto visible sin aria-live y un status educado oculto", () => {
    const { label } = setup();
    expect(label.element.getAttribute("aria-label")).toBe("Estado de los datos");
    expect(label.element.querySelector("ul")?.getAttribute("aria-live")).toBeNull();
    const status = label.element.querySelector("[role=status]");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.className).toContain("sr-only");
    expect(label.element.querySelector(".source-status__mark")).toBeNull();
  });

  it("solo anuncia transiciones, sin minutos; no repite al envejecer", () => {
    const { put, announcement } = setup();
    put("bus", T0);
    put("bike", T0);
    expect(announcement()).toBe("");
    advance(90_000);
    expect(announcement()).toBe("Bus: datos retrasados");
    advance(40_000); // pasa a sin datos: transición
    expect(announcement()).toBe("Bus: sin datos");
    put("bike", Date.now());
    advance(30_000); // sigue sin datos: el texto visible cambia, pero no se re-anuncia
    expect(announcement()).toBe("Bus: sin datos");
    put("bus", Date.now());
    expect(announcement()).toBe("Bus: datos al día");
  });

  it("anuncia la conexión restablecida", () => {
    const { store, put, announcement } = setup();
    put("bus", T0);
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    advance(DISCONNECT_GRACE_MS + 2000);
    expect(announcement()).toBe("Reconectando…");
    put("bus", Date.now());
    store.apply({ type: "status", state: "open", attempt: 0 });
    expect(announcement()).toBe("Conexión restablecida");
  });

  it("destroy() la retira del DOM", () => {
    const { label } = setup();
    label.destroy();
    expect(document.querySelector(".source-status")).toBeNull();
  });
});
