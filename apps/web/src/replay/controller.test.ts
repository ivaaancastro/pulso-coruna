import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../i18n";
import type { WorkerLike } from "../live/client";
import { LiveStore } from "../live/live-store";
import { SwitchableStore } from "../live/switchable-store";
import type { WorkerInput, WorkerOutput } from "../live/types";
import { madridDayStart } from "../time/day";
import { setClockOverride } from "../time/now";
import { createReplayController } from "./controller";

const BASE = Date.parse("2026-11-18T10:00:00Z");

function setup() {
  let perf = 0;
  const frames: (() => void)[] = [];
  const sent: WorkerInput[] = [];
  let worker!: WorkerLike;
  const liveStore = new LiveStore();
  const view = new SwitchableStore(liveStore);
  const liveClient = { store: liveStore, start() {}, stop() {}, setActive: vi.fn() };
  const showTime = vi.fn();
  const refreshPalette = vi.fn();
  const terminate = vi.fn();
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const controller = createReplayController({
    live: { client: liveClient, view },
    replayUrl: "http://x/api/v1/replay",
    baseNow: () => BASE,
    showTime,
    refreshPalette,
    host,
    t: createTranslator("es"),
    locale: "es",
    motion: { matches: false, addEventListener() {}, removeEventListener() {} },
    createWorker: () => {
      worker = {
        postMessage: (m) => sent.push(m),
        onmessage: null,
        terminate,
      };
      return worker;
    },
    perf: () => perf,
    raf: (cb) => {
      frames.push(cb);
      return () => undefined;
    },
  });
  return {
    controller,
    view,
    liveStore,
    liveClient,
    showTime,
    refreshPalette,
    sent,
    terminate,
    host,
    advance: (ms: number) => {
      perf += ms;
      frames.splice(0).forEach((f) => f());
    },
    emit: (out: WorkerOutput) => worker.onmessage?.({ data: out } as MessageEvent<WorkerOutput>),
  };
}

describe("controlador de Reproducir", () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => setClockOverride(null));

  it("entrar: arranca una hora antes de «ahora», pausado, y cambia de fuente sin tocar el directo", () => {
    const s = setup();
    s.controller.enter();
    const st = s.controller.getState();
    expect(st).toMatchObject({ mode: "replay", speed: 60, playing: false });
    expect(st.t).toBe(BASE - 3_600_000);
    expect(st.day).toBe(madridDayStart(BASE));
    expect(s.liveClient.setActive).toHaveBeenLastCalledWith(false);
    expect(s.view.current).not.toBe(s.liveStore);
    expect(s.host.querySelector(".timeline")).not.toBeNull();
    expect((s.host.querySelector(".timeline") as HTMLElement).hidden).toBe(false);
    // El worker recibe el init con nuestra URL del histórico.
    expect(s.sent[0]).toMatchObject({ type: "init", url: "http://x/api/v1/replay" });
  });

  it("el reloj de la app pasa a ser el de reproducción y se restaura al salir", async () => {
    const { createNow } = await import("../time/now");
    const s = setup();
    const now = createNow("");
    s.controller.enter();
    expect(now()).toBe(BASE - 3_600_000);
    s.controller.exit();
    expect(now()).not.toBe(BASE - 3_600_000);
  });

  it("salir restaura el directo (fuente, fotogramas, hora grande y luz) y termina el worker", () => {
    const s = setup();
    s.controller.enter();
    s.controller.exit();
    expect(s.view.current).toBe(s.liveStore);
    expect(s.liveClient.setActive).toHaveBeenLastCalledWith(true);
    expect(s.terminate).toHaveBeenCalled();
    expect(s.showTime).toHaveBeenLastCalledWith(BASE);
    expect(s.refreshPalette).toHaveBeenCalled();
    expect((s.host.querySelector(".timeline") as HTMLElement).hidden).toBe(true);
    expect(s.controller.getState().mode).toBe("view");
  });

  it("reproduce a la velocidad elegida y actualiza la hora grande", () => {
    const s = setup();
    s.controller.enter();
    s.controller.applyState({ speed: 600, playing: true });
    const t0 = s.controller.getState().t;
    s.advance(100);
    expect(s.controller.getState().t - t0).toBe(100 * 600);
    expect(s.showTime).toHaveBeenCalled();
  });

  it("«cargando» detiene el reloj; al llegar la ventana sigue", () => {
    const s = setup();
    s.controller.enter();
    s.controller.applyState({ playing: true });
    s.emit({
      type: "replay",
      status: { loading: true, error: null, noData: false, resolution: null },
    });
    const t0 = s.controller.getState().t;
    s.advance(100);
    expect(s.controller.getState().t).toBe(t0);
    s.advance(500);
    expect(s.host.querySelector(".timeline__status")?.textContent).toBe("Cargando datos…");
    s.emit({
      type: "replay",
      status: { loading: false, error: null, noData: false, resolution: "raw" },
    });
    s.advance(100);
    expect(s.controller.getState().t).toBeGreaterThan(t0);
  });

  it("sin datos y error se dicen con honestidad", () => {
    const s = setup();
    s.controller.enter();
    s.emit({
      type: "replay",
      status: { loading: false, error: null, noData: true, resolution: "raw" },
    });
    s.advance(16);
    expect(s.host.querySelector(".timeline__status")?.textContent).toBe(
      "Sin datos grabados para este instante.",
    );
    s.emit({
      type: "replay",
      status: { loading: true, error: "network", noData: false, resolution: null },
    });
    s.advance(16);
    expect(s.host.querySelector(".timeline__status")?.textContent).toMatch(/Sin conexión/);
  });

  it("cambiar de día conserva la hora local y se acota a «ahora» en el día de hoy", () => {
    const s = setup();
    s.controller.enter();
    const today = s.controller.getState().day;
    const select = s.host.querySelector("select") as HTMLSelectElement;
    select.value = select.options[1]?.value ?? "";
    select.dispatchEvent(new Event("change"));
    const st = s.controller.getState();
    expect(st.day).toBeLessThan(today);
    expect(st.t - st.day).toBe(BASE - 3_600_000 - today);
  });

  it("estado serializable: ida y vuelta por JSON y restauración con applyState", () => {
    const s = setup();
    s.controller.enter();
    s.controller.applyState({ speed: 600 });
    const json = JSON.parse(JSON.stringify(s.controller.getState())) as ReturnType<
      typeof s.controller.getState
    >;
    s.controller.exit();
    s.controller.applyState({ ...json, mode: "replay", playing: false });
    expect(s.controller.getState()).toMatchObject({ mode: "replay", speed: 600, day: json.day });
    expect(Math.abs(s.controller.getState().t - json.t)).toBeLessThan(1000);
  });

  it("abrir con un instante pedido no descarga antes la ventana de hace 1 h", () => {
    const s = setup();
    const target = BASE - 30 * 3_600_000; // ayer por la tarde
    s.controller.applyState({ mode: "replay", t: target, speed: 600, playing: false });
    s.advance(16);
    expect(s.controller.getState()).toMatchObject({ mode: "replay", t: target, speed: 600 });
    expect(s.controller.getState().day).toBe(madridDayStart(target));
    // El primer mensaje al worker (init) ya lleva el instante del enlace: nada se pide para «hace 1 h».
    expect(s.sent[0]).toMatchObject({ type: "init", now: target });
    for (const m of s.sent) if (m.type === "tick") expect(m.now).toBe(target);
  });

  it("enlace con instante de hoy o futuro: entra en él (futuro acotado a «ahora»)", () => {
    const a = setup();
    a.controller.applyState({ mode: "replay", t: BASE - 2 * 3_600_000 });
    expect(a.sent[0]).toMatchObject({ type: "init", now: BASE - 2 * 3_600_000 });
    expect(a.controller.getState().t).toBe(BASE - 2 * 3_600_000);
    const b = setup();
    b.controller.applyState({ mode: "replay", t: BASE + 100_000 });
    expect(b.controller.getState().t).toBe(BASE);
  });
});
