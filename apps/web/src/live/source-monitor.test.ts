import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStore } from "./live-store";
import { createSourceMonitor } from "./source-monitor";
import { DISCONNECT_GRACE_MS } from "./source-status";
import { T0, bus, station } from "./test-helpers";

const now = () => Date.now();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

function setup(extra: Partial<Parameters<typeof createSourceMonitor>[0]> = {}) {
  const store = new LiveStore();
  const monitor = createSourceMonitor({
    store,
    layers: ["bus", "bike"],
    now,
    clock: () => Date.now(),
    ...extra,
  });
  const changes = vi.fn();
  monitor.subscribe(changes);
  monitor.start();
  const items = (layer: "bus" | "bike", ts: number, replace = true) =>
    store.apply({
      type: "items",
      layer,
      replace,
      upserts: [layer === "bus" ? bus("a", { ts }) : station("s", { ts })],
      removes: [],
      receivedAt: Date.now(),
      dataTs: ts,
    });
  return { store, monitor, changes, items };
}

describe("SourceMonitor", () => {
  it("vivo → retrasado → sin datos con el paso del tiempo y avisa solo al cambiar", () => {
    const { monitor, changes, items } = setup();
    items("bus", T0);
    items("bike", T0);
    expect(monitor.status("bus").state).toBe("live");
    changes.mockClear();

    advance(30_000);
    expect(changes).not.toHaveBeenCalled();
    advance(35_000); // 65 s: bus retrasado (60 s), bici aún viva
    expect(monitor.status("bus").state).toBe("delayed");
    expect(monitor.status("bike").state).toBe("live");
    expect(changes).toHaveBeenCalledTimes(1);

    advance(60_000); // 125 s: bus sin datos
    expect(monitor.status("bus")).toEqual({ state: "nodata", lastDataAt: T0 });
    expect(monitor.stateOf(["bus", "bike"])).toBe("nodata");

    items("bus", Date.now()); // llega dato
    expect(monitor.status("bus").state).toBe("live");
  });

  it("una capa vacía tras el snapshot es «sin datos» sin edad", () => {
    const { store, monitor } = setup();
    store.apply({
      type: "items",
      layer: "bus",
      replace: true,
      upserts: [],
      removes: [],
      receivedAt: T0,
      dataTs: 0,
    });
    expect(monitor.status("bus")).toEqual({ state: "nodata", lastDataAt: null });
    expect(monitor.status("bike").state).toBe("live"); // ni siquiera ha llegado: no se sabe
  });

  it("desconexión: gracia, estado «disconnected» y vuelta al abrir", () => {
    const { store, monitor, changes, items } = setup();
    items("bus", T0);
    store.apply({ type: "status", state: "open", attempt: 0 });
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    expect(monitor.disconnected).toBe(false);
    expect(monitor.status("bus").state).toBe("live");

    changes.mockClear();
    advance(DISCONNECT_GRACE_MS + 2000);
    expect(monitor.disconnected).toBe(true);
    expect(monitor.status("bus").state).toBe("disconnected");
    expect(changes).toHaveBeenCalled();

    store.apply({ type: "status", state: "open", attempt: 0 });
    expect(monitor.disconnected).toBe(false);
  });

  it("desconectado desde el principio (el servidor nunca abre) también se avisa", () => {
    const { store, monitor, changes } = setup();
    store.apply({ type: "status", state: "connecting", attempt: 0 });
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    changes.mockClear();
    advance(DISCONNECT_GRACE_MS + 6000);
    expect(monitor.disconnected).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("no depende de que el reloj de la app esté fijado", () => {
    // `?t=` fija `now` en desarrollo: la gracia de la conexión usa el reloj real.
    const { store, monitor } = setup({ now: () => T0 });
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    advance(DISCONNECT_GRACE_MS + 2000);
    expect(monitor.disconnected).toBe(true);
  });

  it("stop() deja de escuchar y de avisar", () => {
    const { store, monitor, changes } = setup();
    monitor.stop();
    changes.mockClear();
    store.apply({ type: "status", state: "reconnecting", attempt: 1 });
    advance(60_000);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("SourceMonitor + /health", () => {
  const emptyBus = (store: LiveStore) => {
    store.apply({ type: "status", state: "open", attempt: 0 });
    store.apply({
      type: "items",
      layer: "bus",
      replace: true,
      upserts: [],
      removes: [],
      receivedAt: T0,
      dataTs: 0,
    });
  };

  it("sondea solo si falta la marca de alguna capa y usa lastDataAt para la edad", async () => {
    const fetchHealth = vi
      .fn()
      .mockResolvedValue({ layers: { bus: { lastDataAt: T0 - 420_000 } } });
    const { store, monitor } = setup({
      layers: ["bus"],
      healthUrl: "http://x/api/v1/health",
      fetchHealth,
    });
    emptyBus(store);
    expect(fetchHealth).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(fetchHealth.mock.calls[0]?.[0]).toBe("http://x/api/v1/health");
    expect(monitor.status("bus")).toEqual({ state: "nodata", lastDataAt: T0 - 420_000 });
  });

  it("no sondea si todas las capas tienen dato, ni sin healthUrl", async () => {
    const fetchHealth = vi.fn().mockResolvedValue({});
    const a = setup({ layers: ["bus"], healthUrl: "http://x/h", fetchHealth });
    a.store.apply({ type: "status", state: "open", attempt: 0 });
    a.items("bus", T0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchHealth).not.toHaveBeenCalled();

    const b = setup({ layers: ["bus"], healthUrl: null, fetchHealth });
    emptyBus(b.store);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it("es tolerante a errores, respuestas rotas y se espacia con espera exponencial", async () => {
    const fetchHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce("basura")
      .mockResolvedValue({ layers: { bus: { lastDataAt: T0 - 1000 } } });
    const { store, monitor } = setup({
      layers: ["bus"],
      healthUrl: "http://x/h",
      fetchHealth,
      pollMs: 10_000,
    });
    emptyBus(store);
    await vi.advanceTimersByTimeAsync(10_000); // falla → espera 20 s
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(monitor.status("bus").lastDataAt).toBeNull();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // basura → espera 40 s
    expect(fetchHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchHealth).toHaveBeenCalledTimes(3);
    expect(monitor.status("bus").lastDataAt).toBe(T0 - 1000);
  });

  it("no sondea con la pestaña oculta ni con el WS caído", async () => {
    const fetchHealth = vi.fn().mockResolvedValue({});
    let hidden = true;
    const { store } = setup({
      layers: ["bus"],
      healthUrl: "http://x/h",
      fetchHealth,
      visible: () => !hidden,
    });
    emptyBus(store);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchHealth).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchHealth).toHaveBeenCalled();
  });
});
