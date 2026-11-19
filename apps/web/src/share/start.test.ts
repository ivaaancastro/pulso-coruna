import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import type { ReplayController } from "../replay/controller";
import { startShare, type StartShareOptions } from "./start";
import type { ShareState } from "./url-state";

type MoveEnd = (e: { originalEvent?: unknown }) => void;

function setup(over: Partial<StartShareOptions> = {}) {
  let moveend: MoveEnd = () => undefined;
  const map = {
    getCenter: () => ({ lat: 43.3623, lng: -8.4115 }),
    getZoom: () => 13.5,
    getBearing: () => 10,
    getPitch: () => 45,
    on: (_: string, cb: MoveEnd) => (moveend = cb),
    off: vi.fn(),
  } as unknown as MapLibreMap;
  const loc = { origin: "https://pulso.example", pathname: "/", search: "", hash: "" };
  const replaceState = vi.fn((_d: unknown, _u: string, url: string) => {
    loc.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  });
  const host = document.createElement("main");
  document.body.replaceChildren(host);
  let mode: "view" | "replay" | "listen" = "view";
  const replay = {
    active: true,
    getState: () => ({ mode: "replay", t: Date.parse("2026-11-18T10:30:00Z"), speed: 60 }),
  } as unknown as ReplayController;
  const handle = startShare({
    map,
    host,
    t: createTranslator("es"),
    initial: { mode: "view" },
    getMode: () => mode,
    getReplay: () => replay,
    restoreReplay: vi.fn().mockResolvedValue(undefined),
    location: loc as unknown as Location,
    history: { replaceState, state: null } as unknown as History,
    ...over,
  });
  return {
    handle,
    host,
    loc,
    replaceState,
    moveend: (e: { originalEvent?: unknown }) => moveend(e),
    setMode: (m: typeof mode) => (mode = m),
  };
}

describe("startShare", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("monta el botón y NO escribe la URL de quien abre sin parámetros (ni con la intro)", () => {
    const { host, replaceState, moveend } = setup();
    expect(host.querySelector(".share__button")).not.toBeNull();
    moveend({}); // jumpTo de la intro: sin originalEvent
    vi.advanceTimersByTime(5000);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("tras un gesto del usuario escribe la cámara (con debounce)", () => {
    const { loc, replaceState, moveend } = setup();
    moveend({ originalEvent: {} });
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(loc.hash).toBe("#v=1&c=43.3623,-8.4115,13.5,10,45");
  });

  it("el enlace compartido siempre lleva la cámara actual y el instante en Reproducir", () => {
    const { handle, setMode } = setup();
    expect(handle.current(true).camera?.zoom).toBe(13.5);
    expect(handle.current(false).camera).toBeUndefined();
    setMode("replay");
    expect(handle.current(true)).toMatchObject({ mode: "replay", speed: 60 });
  });

  it("enlace de Reproducir: no escribe hasta restaurar, y conserva lo pedido mientras carga", async () => {
    let done: () => void = () => undefined;
    const restoreReplay = vi.fn(() => new Promise<void>((r) => (done = r)));
    const initial: ShareState = {
      mode: "replay",
      t: Date.parse("2026-11-18T09:00:00Z"),
      speed: 600,
      camera: { lat: 43.37, lon: -8.4, zoom: 14, bearing: 0, pitch: 0 },
    };
    const { handle, replaceState, setMode } = setup({
      initial,
      restoreReplay,
      getReplay: () => null, // aún cargando
    });
    setMode("replay");
    expect(restoreReplay).toHaveBeenCalledWith(initial);
    vi.advanceTimersByTime(3000);
    expect(replaceState).not.toHaveBeenCalled();
    expect(handle.current(false)).toMatchObject({ mode: "replay", t: initial.t, speed: 600 });
    done();
    await vi.advanceTimersByTimeAsync(1500);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
