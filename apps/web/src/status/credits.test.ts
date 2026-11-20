import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createCreditsPanel, type CreditsPanel, type RowStatus } from "./credits";
import { SOURCES } from "./sources";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const t = createTranslator("es");

/** jsdom no implementa la API de `<dialog>` modal: se simula lo justo (abrir/cerrar y el evento `close`). */
beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let panel: CreditsPanel | null = null;
afterEach(() => {
  panel?.destroy();
  panel = null;
  document.body.replaceChildren();
});

function make(over: { noApi?: boolean; locale?: "es" | "gl" | "en" } = {}) {
  const calls = { open: vi.fn(), retry: vi.fn(), close: vi.fn() };
  const locale = over.locale ?? "es";
  panel = createCreditsPanel({
    t: createTranslator(locale),
    locale,
    noApi: over.noApi ?? false,
    onOpen: calls.open,
    onRetry: calls.retry,
    onClose: calls.close,
  });
  return { p: panel, calls };
}

const item = (p: CreditsPanel, name: string): HTMLElement => {
  const found = [...p.element.querySelectorAll<HTMLElement>(".credits__item")].find(
    (li) => li.querySelector(".credits__name")?.textContent === name,
  );
  if (!found) throw new Error(name);
  return found;
};
const notice = (p: CreditsPanel) => p.element.querySelector<HTMLElement>(".credits__notice");

/** Una fila por fuente, todas al día salvo lo que se pida (por clave del catálogo). */
const rows = (over: Record<string, RowStatus> = {}): RowStatus[] =>
  SOURCES.map(
    (s) =>
      over[s.key] ??
      (s.healthIds.length === 0
        ? { state: "static", lastSuccessAt: null }
        : { state: "live", lastSuccessAt: NOW - 120_000 }),
  );

describe("panel Estado y créditos", () => {
  it("es un diálogo con título accesible y una fila por fuente; abrir avisa y cerrar también", () => {
    const { p, calls } = make();
    expect(p.element.tagName).toBe("DIALOG");
    expect(p.element.getAttribute("aria-labelledby")).toBe("credits-title");
    expect(document.getElementById("credits-title")?.textContent).toBe("Estado y créditos");
    expect(p.element.querySelectorAll(".credits__item")).toHaveLength(SOURCES.length);
    p.open();
    expect(p.element.open).toBe(true);
    expect(calls.open).toHaveBeenCalledTimes(1);
    p.element.querySelector<HTMLButtonElement>(".credits__close")?.click();
    expect(p.element.open).toBe(false);
    expect(calls.close).toHaveBeenCalledTimes(1);
  });

  it("al cerrar devuelve el foco a quien lo abrió y el clic en el fondo cierra", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { p } = make();
    p.open();
    p.element.click();
    expect(p.element.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("antes de saber nada: cargando y las fuentes «sin consultar» (las estáticas sin estado)", () => {
    const { p } = make();
    expect(notice(p)?.textContent).toBe(t("credits.loading"));
    expect(item(p, "BiciCoruña").dataset.state).toBe("unknown");
    expect(item(p, "OpenStreetMap").dataset.state).toBe("static");
  });

  it("sin API: solo créditos", () => {
    const { p } = make({ noApi: true });
    expect(notice(p)?.textContent).toBe(t("credits.noapi"));
    expect(item(p, "BiciCoruña").dataset.state).toBe("unknown");
  });

  it("estado listo: chip por fuente y «Última lectura hace X» contra el reloj del servidor", () => {
    const { p } = make();
    p.update({
      kind: "ready",
      ts: NOW,
      dbDown: false,
      rows: rows({
        portus: { state: "delayed", lastSuccessAt: NOW - 3_600_000 },
        opensky: { state: "nodata", lastSuccessAt: null },
        itranvias: { state: "inactive", lastSuccessAt: null },
      }),
    });
    expect(notice(p)?.hidden).toBe(true);
    const bike = item(p, "BiciCoruña");
    expect(bike.dataset.state).toBe("live");
    expect(bike.textContent).toContain("Al día");
    expect(bike.textContent).toContain("Última lectura hace 2 min");
    expect(item(p, "Puertos del Estado (Portus)").dataset.state).toBe("delayed");
    expect(item(p, "OpenSky Network").textContent).toContain("Sin lecturas");
    expect(item(p, "iTranvías").textContent).toContain("No activa");
    expect(p.element.querySelector('[role="status"]')?.textContent).toBe(t("credits.ready"));
  });

  it("BD caída: avisa aunque haya filas", () => {
    const { p } = make();
    p.update({ kind: "ready", ts: NOW, dbDown: true, rows: rows() });
    expect(notice(p)?.textContent).toBe(t("credits.db.down"));
  });

  it("error: mensaje con «Reintentar», que avisa; las filas siguen mostrando los créditos", () => {
    const { p, calls } = make();
    p.update({ kind: "error" });
    expect(notice(p)?.textContent).toContain(t("credits.error"));
    expect(item(p, "BiciCoruña").textContent).toContain("Concello da Coruña");
    p.element.querySelector<HTMLButtonElement>(".credits__retry")?.click();
    expect(calls.retry).toHaveBeenCalledTimes(1);
  });

  it("atribuciones: Open-Meteo con CC BY 4.0 y nota; licencias sin documentar «pendiente de confirmar»", () => {
    const { p } = make();
    const om = item(p, "Open-Meteo");
    expect(om.textContent).toContain("Open-Meteo.com (datos CAMS)");
    const licence = [...om.querySelectorAll("a")].find((a) =>
      a.textContent?.startsWith("CC BY 4.0"),
    );
    expect(licence?.getAttribute("href")).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(om.textContent).toContain("uso no comercial");
    expect(item(p, "OpenSky Network").textContent).toContain("pendiente de confirmar");
    expect(item(p, "BiciCoruña").textContent).toContain("RISP_AC");
    expect(item(p, "BiciCoruña").textContent).toContain("pendiente de confirmar");
    expect(item(p, "MeteoGalicia").textContent).toContain("CC BY-SA 4.0");
    expect(item(p, "MeteoGalicia").textContent).not.toContain("pendiente");
    for (const a of p.element.querySelectorAll("a")) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
    }
  });

  it("se traduce: gallego e inglés no dejan cadenas en español", () => {
    for (const locale of ["gl", "en"] as const) {
      const { p } = make({ locale });
      p.update({ kind: "ready", ts: NOW, dbDown: false, rows: rows() });
      const text = p.element.textContent ?? "";
      expect(text, locale).not.toContain("Fuentes de datos");
      expect(text, locale).toContain(locale === "gl" ? "Fontes de datos" : "Data sources");
      expect(document.getElementById("credits-title")?.textContent).toBe(
        locale === "gl" ? "Estado e créditos" : "Status and credits",
      );
      p.destroy();
    }
  });
});
