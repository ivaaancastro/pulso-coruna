import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import { createClipButton, CLIP_MESSAGE_MS } from "./button";
import type { ClipContext, ClipOutcome, ClipProgress, ClipSession } from "./types";

const t = createTranslator("es");
const ctx = {} as ClipContext;

interface Fake {
  session: ClipSession;
  progress: (p: ClipProgress) => void;
  finish: (o: ClipOutcome) => void;
  fail: (e: Error) => void;
}

function setup(over: { supported?: boolean; context?: () => ClipContext | null } = {}) {
  let fake: Fake | undefined;
  const button = createClipButton({
    t,
    supported: over.supported ?? true,
    context: over.context ?? (() => ctx),
    load: () =>
      Promise.resolve({
        startClip: (_c, onProgress) => {
          let finish: (o: ClipOutcome) => void = () => undefined;
          let fail: (e: Error) => void = () => undefined;
          const done = new Promise<ClipOutcome>((res, rej) => {
            finish = res;
            fail = rej;
          });
          const session = {
            done,
            cancel: vi.fn(() => finish({ kind: "cancelled", reason: "user" })),
          };
          fake = { session, progress: onProgress, finish, fail };
          return session;
        },
      }),
  });
  document.body.replaceChildren(button.element);
  const el = button.element.querySelector("button") as HTMLButtonElement;
  const status = button.element.querySelector("[role=status]") as HTMLElement;
  const bar = button.element.querySelector("progress") as HTMLProgressElement;
  return { button, el, status, bar, fake: () => fake as Fake };
}
const tick = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

describe("botón de clip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reposo: botón con nombre accesible, región aria-live y barra oculta", () => {
    const { el, status, bar } = setup();
    expect(el.getAttribute("aria-label")).toBe("Grabar clip vertical de 15 segundos");
    expect(el.getAttribute("aria-disabled")).toBeNull();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(bar.hidden).toBe(true);
  });

  it("grabando: el botón pasa a cancelar, la barra avanza por segundos y se anuncia el inicio", async () => {
    const { el, status, bar, fake } = setup();
    el.click();
    await tick();
    fake().progress({ phase: "recording", elapsedMs: 0, durationMs: 15_000 });
    expect(el.getAttribute("aria-label")).toBe("Cancelar grabación del clip");
    expect(bar.hidden).toBe(false);
    expect(status.textContent).toContain("Grabando clip de 15 s");
    fake().progress({ phase: "recording", elapsedMs: 7_400, durationMs: 15_000 });
    expect(bar.value).toBe(7);
    expect(bar.getAttribute("aria-valuetext")).toBe("Grabando: 7 de 15 s");
    expect(status.textContent).toContain("Grabando clip de 15 s"); // no se anuncia cada segundo
  });

  it("terminar: archivo guardado, vuelve al reposo y el mensaje se retira; el foco no se mueve", async () => {
    const { el, status, bar, fake, button } = setup();
    document.body.append(el);
    el.focus();
    el.click();
    await tick();
    fake().progress({ phase: "recording", elapsedMs: 0, durationMs: 15_000 });
    fake().progress({ phase: "finishing", elapsedMs: 15_000, durationMs: 15_000 });
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(status.textContent).toBe("Preparando el archivo…");
    fake().finish({ kind: "done", fileName: "a.mp4" });
    await tick();
    await tick();
    expect(status.textContent).toBe("Clip guardado en tus descargas.");
    expect(el.getAttribute("aria-label")).toBe("Grabar clip vertical de 15 segundos");
    expect(bar.hidden).toBe(true);
    expect(button.element.dataset["state"]).toBe("idle");
    expect(document.activeElement).toBe(el);
    vi.advanceTimersByTime(CLIP_MESSAGE_MS);
    expect(status.textContent).toBe("");
  });

  it("pulsar de nuevo o Escape cancelan", async () => {
    const a = setup();
    a.el.click();
    await tick();
    a.fake().progress({ phase: "recording", elapsedMs: 1_000, durationMs: 15_000 });
    a.el.click();
    expect(a.fake().session.cancel).toHaveBeenCalled();
    await tick();
    await tick();
    expect(a.status.textContent).toBe("Grabación cancelada.");

    const b = setup();
    b.el.click();
    await tick();
    b.fake().progress({ phase: "recording", elapsedMs: 1_000, durationMs: 15_000 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(b.fake().session.cancel).toHaveBeenCalled();
  });

  it("segundo plano y errores tienen su mensaje", async () => {
    const a = setup();
    a.el.click();
    await tick();
    a.fake().finish({ kind: "cancelled", reason: "hidden" });
    await tick();
    await tick();
    expect(a.status.textContent).toBe("Grabación cancelada: la pestaña pasó a segundo plano.");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = setup();
    b.el.click();
    await tick();
    b.fake().fail(new Error("stalled"));
    await tick();
    await tick();
    expect(b.status.textContent).toBe("No se pudo grabar el clip.");
    const c = setup();
    c.el.click();
    await tick();
    c.fake().fail(new Error("unsupported"));
    await tick();
    await tick();
    expect(c.status.textContent).toBe("Tu navegador no puede grabar clips.");
  });

  it("no soportado: aria-disabled, explicación accesible y no carga el motor", () => {
    const load = vi.fn();
    const button = createClipButton({ t, supported: false, context: () => ctx, load });
    document.body.replaceChildren(button.element);
    const el = button.element.querySelector("button") as HTMLButtonElement;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Tu navegador no puede grabar clips.");
    el.click();
    expect(button.element.querySelector("[role=status]")?.textContent).toBe(
      "Tu navegador no puede grabar clips.",
    );
    expect(load).not.toHaveBeenCalled();
  });

  it("sin mapa listo avisa y no graba", () => {
    const { el, status } = setup({ context: () => null });
    el.click();
    expect(status.textContent).toBe("El mapa aún no está listo.");
  });

  it("cancelar mientras carga el motor no empieza a grabar", async () => {
    let release: () => void = () => undefined;
    const startClip = vi.fn();
    const button = createClipButton({
      t,
      supported: true,
      context: () => ctx,
      load: () =>
        new Promise((res) => {
          release = () => res({ startClip });
        }),
    });
    document.body.replaceChildren(button.element);
    const el = button.element.querySelector("button") as HTMLButtonElement;
    el.click();
    el.click();
    release();
    await tick();
    await tick();
    expect(startClip).not.toHaveBeenCalled();
    expect(button.element.querySelector("[role=status]")?.textContent).toBe("Grabación cancelada.");
  });
});
