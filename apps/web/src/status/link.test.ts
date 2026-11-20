import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createCreditsLink } from "./link";
import type { StatusHandle } from "./start";

const t = createTranslator("es");

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

afterEach(() => document.body.replaceChildren());

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("enlace «Estado y créditos»", () => {
  it("es un botón discreto con el texto traducido que abre un diálogo", () => {
    const button = createCreditsLink({ t, locale: "es", streamUrl: null });
    document.body.append(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Estado y créditos");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.querySelector("dialog")).toBeNull();
    button.click();
    expect(document.querySelector("dialog")?.open).toBe(true);
  });

  it("sin API no descarga el chunk de estado", () => {
    const loadStatus = vi.fn();
    const button = createCreditsLink({ t, locale: "es", streamUrl: null, loadStatus });
    document.body.append(button);
    button.click();
    expect(loadStatus).not.toHaveBeenCalled();
    expect(document.querySelector(".credits__notice")?.textContent).toBe(t("credits.noapi"));
  });

  it("con API carga el chunk al abrir, consulta en cada apertura y cancela al cerrar", async () => {
    const handle: StatusHandle = { refresh: vi.fn(() => Promise.resolve()), cancel: vi.fn() };
    const startStatus = vi.fn(() => handle);
    const loadStatus = vi.fn(() => Promise.resolve({ startStatus }) as never);
    const button = createCreditsLink({
      t,
      locale: "es",
      streamUrl: "ws://localhost:5173/api/v1/stream",
      loadStatus,
    });
    document.body.append(button);
    button.click();
    await flush();
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(handle.refresh).toHaveBeenCalledTimes(1);
    document.querySelector("dialog")?.querySelector<HTMLButtonElement>(".credits__close")?.click();
    await flush();
    expect(handle.cancel).toHaveBeenCalledTimes(1);
    button.click();
    await flush();
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(handle.refresh).toHaveBeenCalledTimes(2);
  });

  it("si el chunk no carga, el panel sigue con los créditos y avisa del error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadStatus = vi.fn(() => Promise.reject(new Error("offline")));
    const button = createCreditsLink({
      t,
      locale: "es",
      streamUrl: "ws://localhost:5173/api/v1/stream",
      loadStatus,
    });
    document.body.append(button);
    button.click();
    await flush();
    expect(document.querySelector(".credits__notice")?.textContent).toContain(t("credits.error"));
    expect(document.querySelectorAll(".credits__item").length).toBeGreaterThan(5);
  });
});
