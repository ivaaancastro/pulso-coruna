import { beforeEach, describe, expect, it } from "vitest";
import { createTranslator } from "../i18n";
import { deriveSnapshot, pulseWindow, type PulseData } from "../pulse/model";
import { createPulseIndex } from "./pulse-index";

const NOW = Date.parse("2026-11-19T12:03:27Z");

function data(profile: "fixed" | "learned" = "fixed", values = [40, 52, 63]): PulseData {
  const w = pulseWindow(NOW);
  return {
    ...w,
    profile,
    points: values.map((value, i) => ({
      ts: w.to - (values.length - i) * w.stepMs,
      value,
      layers: {},
    })),
  };
}

function setup(lang: "es" | "gl" | "en" = "es") {
  const view = createPulseIndex(createTranslator(lang), { reducedMotion: () => true });
  document.body.replaceChildren(view.element);
  const q = <T extends Element>(sel: string): T => {
    const el = view.element.querySelector<T>(sel);
    if (!el) throw new Error(sel);
    return el;
  };
  return { view, q };
}

describe("índice Pulso (vista)", () => {
  beforeEach(() => document.body.replaceChildren());

  it("nace cargando: número atenuado «–», sin valor ficticio", () => {
    const { view, q } = setup();
    expect(view.element.dataset.status).toBe("loading");
    expect(q(".pulse__number").textContent).toBe("–");
    expect(view.element.textContent).not.toContain("62");
    expect(q(".pulse__note").textContent).toBe("Calculando…");
  });

  it("listo: número real, serie con role=img y texto alternativo, etiqueta de perfil fijo", () => {
    const { view, q } = setup();
    view.render(deriveSnapshot(data(), null, NOW));
    expect(view.element.dataset.status).toBe("ready");
    expect(q(".pulse__number").textContent).toBe("63");
    expect(q(".pulse__sr").textContent).toBe("Índice Pulso: 63 de 100");
    expect(q(".pulse__number").getAttribute("aria-hidden")).toBe("true");
    const svg = q<SVGElement>(".pulse__series");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(
      "Índice Pulso de las últimas 24 horas: mínimo 40, máximo 63, ahora 63. 50 es lo habitual.",
    );
    expect(q(".pulse__line").getAttribute("d")).toMatch(/^M/);
    expect(q(".pulse__note").textContent).toBe("Perfil fijo: nivel sin calibrar");
    expect(q<HTMLElement>(".pulse__note").hidden).toBe(false);
    expect(view.element.dataset.fixed).toBe("true");
  });

  it("perfil aprendido: sin etiqueta de perfil fijo", () => {
    const { view, q } = setup();
    view.render(deriveSnapshot(data("learned"), null, NOW));
    expect(q<HTMLElement>(".pulse__note").hidden).toBe(true);
    expect(view.element.dataset.fixed).toBe("false");
  });

  it.each([
    ["error", "No se pudo cargar el índice"],
    ["nodata", "Sin datos para esta hora"],
  ] as const)("%s: número atenuado, explicado y sin serie", (failure, text) => {
    const { view, q } = setup();
    view.render(deriveSnapshot(data(), null, NOW)); // venía con datos
    view.render(deriveSnapshot(null, failure, NOW));
    expect(view.element.dataset.status).toBe(failure);
    expect(q(".pulse__number").textContent).toBe("–");
    expect(q(".pulse__note").textContent).toBe(text);
    expect(q(".pulse__line").getAttribute("d")).toBe("");
    expect(q(".pulse__series").getAttribute("aria-label")).toContain("Sin serie");
    expect(q(".pulse__sr").textContent).toBe("");
  });

  it("recientes ausentes: conserva el último valor atenuado y lo explica junto al perfil fijo", () => {
    const { view, q } = setup();
    const d = data();
    const old = { ...d, points: d.points.map((p) => ({ ...p, ts: p.ts - 40 * 60_000 })) };
    view.render(deriveSnapshot(old, null, NOW));
    expect(view.element.dataset.status).toBe("stale");
    expect(q(".pulse__number").textContent).toBe("63");
    expect(q(".pulse__note").textContent).toBe(
      "Sin datos recientes · Perfil fijo: nivel sin calibrar",
    );
  });

  it("vuelve a contar desde cero tras un hueco, y no repinta si nada cambia", () => {
    const { view, q } = setup();
    const snap = deriveSnapshot(data(), null, NOW);
    view.render(snap);
    const before = q(".pulse__line").getAttribute("d");
    q(".pulse__line").setAttribute("d", "X");
    view.render(snap); // misma clave: no toca el DOM
    expect(q(".pulse__line").getAttribute("d")).toBe("X");
    view.render(deriveSnapshot(null, "error", NOW));
    view.render(snap);
    expect(q(".pulse__line").getAttribute("d")).toBe(before);
  });

  it("i18n: gl y en, sin cadenas fijas", () => {
    for (const [lang, label, fixed, now] of [
      ["gl", "Índice Pulso", "Perfil fixo: nivel sen calibrar", "agora 63"],
      ["en", "Pulso index", "Fixed profile: level not calibrated", "now 63"],
    ] as const) {
      const { view, q } = setup(lang);
      view.render(deriveSnapshot(data(), null, NOW));
      expect(view.element.getAttribute("aria-label")).toBe(label);
      expect(q(".pulse__note").textContent).toBe(fixed);
      expect(q(".pulse__series").getAttribute("aria-label")).toContain(now);
    }
  });
});
