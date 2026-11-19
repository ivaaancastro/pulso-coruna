import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createShareButton, MESSAGE_MS } from "./share-button";

const t = createTranslator("es");
const URL_ = "https://pulso.example/#v=1&m=r";

function setup(nav: Partial<Pick<Navigator, "share" | "clipboard">>, preferNativeShare = true) {
  const button = createShareButton({
    t,
    getUrl: () => URL_,
    nav: nav as Pick<Navigator, "share" | "clipboard">,
    preferNativeShare,
  });
  document.body.replaceChildren(button.element);
  const status = button.element.querySelector<HTMLElement>("[role=status]") as HTMLElement;
  return { button, status };
}

describe("botón compartir", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("es un botón con nombre accesible y una región aria-live", () => {
    const { button, status } = setup({});
    const b = button.element.querySelector("button") as HTMLButtonElement;
    expect(b.getAttribute("aria-label")).toBe("Compartir enlace a esta vista");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("usa navigator.share si existe y es táctil; sin mensaje", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    const { button, status } = setup({ share, clipboard: { writeText } as unknown as Clipboard });
    await button.activate();
    expect(share).toHaveBeenCalledWith({ title: "Pulso A Coruña", url: URL_ });
    expect(writeText).not.toHaveBeenCalled();
    expect(status.textContent).toBe("");
  });

  it("sin share (o en escritorio) copia al portapapeles y lo anuncia; el mensaje se retira", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { button, status } = setup(
      { share: vi.fn(), clipboard: { writeText } as unknown as Clipboard },
      false,
    );
    await button.activate();
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(status.textContent).toBe("Enlace copiado.");
    vi.advanceTimersByTime(MESSAGE_MS + 10);
    expect(status.textContent).toBe("");
  });

  it("cerrar la hoja de compartir (AbortError) no copia ni avisa", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
    const writeText = vi.fn();
    const { button, status } = setup({ share, clipboard: { writeText } as unknown as Clipboard });
    await button.activate();
    expect(writeText).not.toHaveBeenCalled();
    expect(status.textContent).toBe("");
  });

  it("si share falla de verdad, cae al portapapeles", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { button, status } = setup({ share, clipboard: { writeText } as unknown as Clipboard });
    await button.activate();
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(status.textContent).toBe("Enlace copiado.");
  });

  it("sin ningún medio, avisa del fallo", async () => {
    const { button, status } = setup({});
    await button.activate();
    expect(status.textContent).toBe("No se pudo copiar el enlace.");
  });
});
