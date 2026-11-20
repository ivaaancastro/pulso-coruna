import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PulseFetchError } from "./client";
import {
  RETRY_MS,
  TICK_MS,
  WINDOW_DEBOUNCE_MS,
  createPulseController,
  type PulseControllerOptions,
} from "./controller";
import { PULSE_STEP_MS, pulseWindow, type PulseData, type PulseSnapshot } from "./model";

const T0 = Date.parse("2026-11-19T12:03:27Z");

function dataFor(w: { from: number; to: number; stepMs: number }): PulseData {
  const last = w.to - w.stepMs;
  return {
    ...w,
    profile: "fixed",
    points: [
      { ts: last - w.stepMs, value: 40, layers: {} },
      { ts: last, value: 55, layers: {} },
    ],
  };
}

function setup(over: Partial<PulseControllerOptions> = {}) {
  let now = T0;
  let hidden = false;
  let onVis: () => void = () => undefined;
  const snaps: PulseSnapshot[] = [];
  const fetchWindow = vi.fn<PulseControllerOptions["fetchWindow"]>(async (_u, w) => dataFor(w));
  const controller = createPulseController({
    url: "/api/v1/pulse",
    now: () => now,
    wall: () => Date.now(),
    render: (s) => snaps.push(s),
    fetchWindow,
    visibility: {
      hidden: () => hidden,
      subscribe: (cb) => {
        onVis = cb;
        return () => undefined;
      },
    },
    ...over,
  });
  return {
    controller,
    fetchWindow,
    snaps,
    last: () => snaps[snaps.length - 1] as PulseSnapshot,
    setNow: (ms: number) => (now = ms),
    setHidden: (h: boolean) => {
      hidden = h;
      onVis();
    },
  };
}

const flush = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("controlador del índice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("primera carga inmediata de las últimas 24 h con paso de 5 min, y pasa a listo", async () => {
    const s = setup();
    s.controller.start();
    expect(s.last().status).toBe("loading");
    await flush();
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
    const w = s.fetchWindow.mock.calls[0]?.[1];
    expect(w).toEqual(pulseWindow(T0));
    expect(w?.stepMs).toBe(PULSE_STEP_MS);
    expect(s.last()).toMatchObject({ status: "ready", value: 55, profile: "fixed" });
    s.controller.destroy();
  });

  it("refresco cada 5 min (una petición por ventana), no en cada tic", async () => {
    const s = setup();
    s.controller.start();
    await flush();
    await flush(TICK_MS * 30);
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
    s.setNow(pulseWindow(T0).to + 1000);
    await flush(TICK_MS + WINDOW_DEBOUNCE_MS + 10);
    expect(s.fetchWindow).toHaveBeenCalledTimes(2);
    expect(s.fetchWindow.mock.calls[1]?.[1].to).toBe(pulseWindow(T0).to + PULSE_STEP_MS);
    s.controller.destroy();
  });

  it("pestaña oculta: no pide ni sigue el reloj; al volver sincroniza", async () => {
    const s = setup();
    s.setHidden(true);
    s.controller.start();
    await flush(TICK_MS * 5);
    expect(s.fetchWindow).not.toHaveBeenCalled();
    s.setHidden(false);
    await flush();
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
    s.setHidden(true);
    s.setNow(T0 + 20 * PULSE_STEP_MS);
    await flush(TICK_MS * 5 + WINDOW_DEBOUNCE_MS * 2);
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
    s.controller.destroy();
  });

  it("Reproducir: mover el reloj antes de asentarse solo pide la ventana final (antirrebote)", async () => {
    const s = setup();
    s.controller.start();
    await flush();
    for (let i = 1; i <= 5; i++) {
      s.setNow(T0 - i * 3 * 3_600_000);
      s.controller.sync();
      await flush(100);
    }
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
    await flush(WINDOW_DEBOUNCE_MS);
    expect(s.fetchWindow).toHaveBeenCalledTimes(2);
    expect(s.fetchWindow.mock.calls[1]?.[1]).toEqual(pulseWindow(T0 - 15 * 3_600_000));
    expect(s.last().status).toBe("ready");
    s.controller.destroy();
  });

  it("error: se atenúa, no revienta, y reintenta tras 30 s", async () => {
    let fail = true;
    const s = setup({
      fetchWindow: async (_u, w) => {
        if (fail) throw new PulseFetchError("HTTP 503", "error");
        return dataFor(w);
      },
    });
    s.controller.start();
    await flush();
    expect(s.last()).toMatchObject({ status: "error", value: null });
    fail = false;
    await flush(RETRY_MS - 2000);
    expect(s.last().status).toBe("error");
    await flush(2500); // el reintento se mide con reloj de pared
    await flush(TICK_MS * 3);
    expect(s.last().status).toBe("ready");
    s.controller.destroy();
  });

  it("el reintento no depende del reloj de la app (Reproducir puede ir hacia atrás o muy rápido)", async () => {
    let calls = 0;
    const s = setup({
      fetchWindow: async () => {
        calls++;
        throw new PulseFetchError("HTTP 503", "error");
      },
    });
    s.controller.start();
    await flush();
    expect(calls).toBe(1);
    // El reloj reproducido salta una hora hacia atrás y vuelve: la ventana es otra y luego la misma.
    s.setNow(T0 - 3_600_000 * 20);
    s.setNow(T0 + 5000);
    await flush(TICK_MS * 5);
    expect(calls).toBe(1); // aún no han pasado 30 s de pared
    await flush(RETRY_MS);
    expect(calls).toBe(2);
    s.controller.destroy();
  });

  it("la API rechaza la ventana (400): «sin datos», no «error»", async () => {
    const s = setup({
      fetchWindow: async () => {
        throw new PulseFetchError("HTTP 400", "nodata");
      },
    });
    s.controller.start();
    await flush();
    expect(s.last().status).toBe("nodata");
    s.controller.destroy();
  });

  it("destroy detiene los tics y no vuelve a pedir", async () => {
    const s = setup();
    s.controller.start();
    await flush();
    s.controller.destroy();
    s.setNow(T0 + 10 * PULSE_STEP_MS);
    await flush(TICK_MS * 10);
    expect(s.fetchWindow).toHaveBeenCalledTimes(1);
  });
});
