import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareState } from "./url-state";
import { createUrlSync, POLL_MS } from "./url-sync";

function setup(initialHash = "") {
  let state: ShareState | null = { mode: "view" };
  const loc = { pathname: "/", search: "?lang=en", hash: initialHash };
  const replaceState = vi.fn((_data: unknown, _unused: string, url: string) => {
    loc.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  });
  const sync = createUrlSync({
    read: () => state,
    location: loc,
    history: { replaceState, state: null },
    debounceMs: 400,
    hidden: () => false,
  });
  return {
    sync,
    replaceState,
    loc,
    set: (s: ShareState | null) => (state = s),
  };
}

describe("sincronía del hash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounce: una ráfaga de cambios de cámara escribe una sola vez, con replaceState", () => {
    const { sync, replaceState, set } = setup();
    set({ mode: "view", camera: { lat: 43.37, lon: -8.4, zoom: 14, bearing: 0, pitch: 0 } });
    for (let i = 0; i < 50; i++) {
      sync.request();
      vi.advanceTimersByTime(20);
    }
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]?.[2]).toBe("/?lang=en#v=1&c=43.37,-8.4,14,0,0");
  });

  it("conserva los parámetros de depuración de la query (?lang=, ?t=…)", () => {
    const { sync, replaceState, set } = setup();
    set({ mode: "replay", t: Date.parse("2026-11-18T10:30:00Z") });
    sync.flush();
    expect(replaceState.mock.calls[0]?.[2]).toMatch(/^\/\?lang=en#/);
  });

  it("sondeo: no escribe si el hash no cambió (pausado) y como mucho una vez por segundo si avanza", () => {
    const { sync, replaceState, set } = setup();
    const t0 = Date.parse("2026-11-18T10:30:00Z");
    set({ mode: "replay", t: t0, speed: 600 });
    sync.start();
    vi.advanceTimersByTime(POLL_MS); // primera escritura
    expect(replaceState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * POLL_MS); // mismo t: nada
    expect(replaceState).toHaveBeenCalledTimes(1);
    // Reproduciendo a 600×: el texto cambia cada tick, pero se escribe como mucho 1/s.
    for (let i = 1; i <= 10; i++) {
      set({ mode: "replay", t: t0 + i * 600_000, speed: 600 });
      vi.advanceTimersByTime(100); // varios fotogramas por segundo
    }
    expect(replaceState.mock.calls.length).toBeLessThanOrEqual(2);
    sync.stop();
  });

  it("modo Ver: nunca escribe t aunque el sondeo siga activo", () => {
    const { sync, replaceState, set } = setup();
    set({ mode: "view", camera: { lat: 43.37, lon: -8.4, zoom: 14, bearing: 0, pitch: 0 } });
    sync.start();
    vi.advanceTimersByTime(10 * POLL_MS);
    for (const call of replaceState.mock.calls) expect(String(call[2])).not.toContain("t=");
    expect(replaceState).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it("al volver a Ver, el hash pierde m/t/s", () => {
    const { sync, loc, set } = setup();
    set({ mode: "replay", t: Date.parse("2026-11-18T10:30:00Z"), speed: 60 });
    sync.flush();
    expect(loc.hash).toContain("m=r");
    set({ mode: "view" });
    sync.flush();
    expect(loc.hash).toBe("");
  });

  it("no escribe mientras read() devuelva null (restauración en curso) ni si ya coincide", () => {
    const { sync, replaceState, set } = setup("#v=1&m=r");
    set(null);
    sync.flush();
    set({ mode: "replay" });
    sync.flush(); // el hash ya es el mismo
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("pestaña oculta: no sondea", () => {
    let hidden = true;
    const replaceState = vi.fn();
    const sync = createUrlSync({
      read: () => ({ mode: "replay", t: Date.parse("2026-11-18T10:30:00Z") }),
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState, state: null },
      hidden: () => hidden,
    });
    sync.start();
    vi.advanceTimersByTime(3 * POLL_MS);
    expect(replaceState).not.toHaveBeenCalled();
    hidden = false;
    vi.advanceTimersByTime(POLL_MS);
    expect(replaceState).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it("si replaceState lanza (límite de Safari), no rompe y reintenta después", () => {
    const { sync, replaceState, set } = setup();
    set({ mode: "replay" });
    replaceState.mockImplementationOnce(() => {
      throw new DOMException("too many", "SecurityError");
    });
    expect(() => sync.flush()).not.toThrow();
    sync.flush();
    expect(replaceState).toHaveBeenCalledTimes(2);
  });
});
