import type { LayerItem } from "@pulso/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConductor, LOOKAHEAD_SEC, TICK_MS } from "./conductor";
import { createUserContext } from "./context";
import { MASTER_CAP, createEngine } from "./engine";
import { STEP_SEC, createRng } from "./grid";
import { PRIORITY, type MusicEvent } from "./score";
import { startAudio } from "./start";
import { SILENT_STATE, type SoundState } from "./state";
import { MAX_VOICES } from "./voices";
import { FakeContext, FakeFilter, FakeGain, noWait } from "./test-helpers";

const note = (over: Partial<MusicEvent> = {}): MusicEvent => ({
  layer: "bus",
  kind: "note",
  step: 0,
  freq: 440,
  gain: 0.1,
  dur: 0.2,
  priority: PRIORITY.bus,
  ...over,
});

const gainNodes = (ctx: FakeContext): FakeGain[] =>
  ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain);

describe("motor", () => {
  it("salida: voces → capas → maestra con tope → limitador → destino", () => {
    const ctx = new FakeContext();
    createEngine(ctx, { wait: noWait });
    const compressor = ctx.nodes.find((n) => n.kind === "compressor");
    expect(compressor?.connected.has(ctx.destination)).toBe(true);
    const master = gainNodes(ctx).find((g) => g.connected.has(compressor));
    expect(master).toBeTruthy();
    const ramp = master?.gain.calls.filter((c) => c.kind === "ramp") ?? [];
    expect(ramp.at(-1)?.value).toBe(MASTER_CAP);
    // arranca en silencio (sin chasquido de entrada)
    expect(master?.gain.calls[0]).toMatchObject({ kind: "set", value: 0 });
  });

  it("reserva 2 voces permanentes (mar y viento)", () => {
    const engine = createEngine(new FakeContext(), { wait: noWait });
    expect(engine.activeVoices()).toBe(2);
    expect(engine.maxVoices).toBe(MAX_VOICES);
  });

  it("la envolvente de cada voz nace y muere en 0 (sin chasquidos)", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    const before = ctx.nodes.length;
    expect(engine.play(note(), 0.1)).toBe(true);
    const env = gainNodes(ctx).find((g) => ctx.nodes.indexOf(g) >= before);
    const calls = env?.gain.calls ?? [];
    expect(calls[0]).toMatchObject({ kind: "set", value: 0 });
    expect(calls.at(-1)).toMatchObject({ kind: "ramp", value: 0 });
    const peak = calls.find((c) => c.kind === "ramp" && c.value > 0);
    expect(peak?.time).toBeGreaterThan(0.1); // ataque con rampa, no escalón
    const osc = ctx.oscillators().at(-1);
    expect(osc?.started).toBe(0.1);
    expect(osc?.stopped).toBeGreaterThan(0.3);
  });

  it("nunca hay más de 16 voces y roba las de menor prioridad", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    for (let i = 0; i < 200; i++) {
      engine.play(note({ step: i }), 0.1 + i * 0.001);
      expect(engine.activeVoices()).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(engine.activeVoices()).toBe(MAX_VOICES);
    // un acento de más prioridad entra robando; uno de prioridad inferior a todo se descarta
    expect(engine.play(note({ layer: "ship", kind: "horn", priority: PRIORITY.ship }), 0.5)).toBe(
      true,
    );
    expect(engine.play(note({ priority: 0 }), 0.5)).toBe(false);
    expect(engine.activeVoices()).toBe(MAX_VOICES);
    // las dos permanentes nunca se roban: tras el diluvio siguen sonando
    const live = ctx.oscillators().filter((o) => !o.disconnected);
    expect(live.length).toBeGreaterThanOrEqual(3);
  });

  it("al robar una voz se corta con rampa corta, no en seco", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    for (let i = 0; i < MAX_VOICES - 2; i++) engine.play(note({ step: i }), 1 + i * 0.01);
    ctx.currentTime = 1.05;
    const stolenEnv = gainNodes(ctx).find((g) => g.gain.calls.length === 3 && g.connected.size > 0);
    engine.play(note({ step: 99 }), 1.06);
    const killed = gainNodes(ctx).filter((g) =>
      g.gain.calls.some((c) => c.kind === "target" && c.value === 0),
    );
    expect(killed.length).toBeGreaterThan(0);
    expect(stolenEnv).toBeTruthy();
    expect(engine.activeVoices()).toBeLessThanOrEqual(MAX_VOICES);
  });

  it("libera la voz cuando la fuente termina (onended)", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    engine.play(note(), 0);
    expect(engine.activeVoices()).toBe(3);
    ctx.oscillators().at(-1)?.end();
    expect(engine.activeVoices()).toBe(2);
    expect(ctx.nodes.filter((n) => n.kind === "gain").at(-1)?.disconnected).toBe(true);
  });

  it("las voces caducadas se liberan aunque onended no llegue", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    engine.play(note({ dur: 0.1 }), 0);
    ctx.currentTime = 5;
    engine.play(note(), 5);
    expect(engine.activeVoices()).toBe(3);
  });

  it("las capas continuas siguen marea y viento con rampas", () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    const s = (tide: number, speed: number): SoundState => ({
      ...SILENT_STATE,
      sea: { tide },
      wind: { speed },
    });
    engine.setContinuous(s(0.1, 1));
    engine.setContinuous(s(0.9, 18));
    const filters = ctx.nodes.filter((n): n is FakeFilter => n instanceof FakeFilter);
    const low = filters.find((f) => f.type === "lowpass");
    const band = filters.find((f) => f.type === "bandpass");
    const targets = (f: FakeFilter | undefined) =>
      f?.frequency.calls.filter((c) => c.kind === "target") ?? [];
    const [lowA = 0, lowB = 0] = targets(low).map((c) => c.value);
    const [bandA = 0, bandB = 0] = targets(band).map((c) => c.value);
    expect(lowB).toBeGreaterThan(lowA); // más marea, más brillo
    expect(bandB).toBeGreaterThan(bandA); // más viento, más agudo
  });

  it("apagar libera todos los nodos, funde a 0 y cierra el contexto", async () => {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    for (let i = 0; i < 10; i++) engine.play(note({ step: i }), 0.1);
    expect(ctx.live().length).toBeGreaterThan(10);
    await engine.dispose();
    expect(ctx.live()).toEqual([]);
    expect(ctx.closed).toBe(true);
    expect(engine.activeVoices()).toBe(0);
    expect(engine.play(note(), 0)).toBe(false);
    await engine.dispose(); // idempotente
  });
});

describe("planificador", () => {
  const busyState: SoundState = {
    ...SILENT_STATE,
    bus: { count: 60 },
    bike: { stations: 10, availability: 0.5 },
  };

  function setup(opts: { transients?: () => boolean; state?: SoundState } = {}) {
    const ctx = new FakeContext();
    const engine = createEngine(ctx, { wait: noWait });
    const play = vi.spyOn(engine, "play");
    const conductor = createConductor({
      engine,
      readState: () => opts.state ?? busyState,
      rng: createRng(5),
      ...(opts.transients ? { transientsEnabled: opts.transients } : {}),
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    return { ctx, engine, play, conductor };
  }

  it("programa por adelantado, exactamente sobre la rejilla y sin repetir pasos", () => {
    const { ctx, play, conductor } = setup();
    conductor.start();
    for (let i = 1; i <= 200; i++) {
      ctx.currentTime = (i * TICK_MS) / 1000;
      conductor.tick();
    }
    expect(play.mock.calls.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    for (const [e, when] of play.mock.calls) {
      expect(when / STEP_SEC).toBeCloseTo(Math.round(when / STEP_SEC), 6);
      expect(when).toBeLessThanOrEqual(5 + LOOKAHEAD_SEC + 1e-9);
      const key = `${e.layer}:${e.kind}:${e.step}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("con muchísima actividad durante 60 s no pasa de 16 voces", () => {
    const { ctx, engine, conductor } = setup();
    conductor.start();
    let max = 0;
    for (let i = 1; i <= 2400; i++) {
      ctx.currentTime = (i * TICK_MS) / 1000;
      conductor.tick();
      max = Math.max(max, engine.activeVoices());
    }
    expect(max).toBeLessThanOrEqual(MAX_VOICES);
    expect(max).toBeGreaterThan(2);
  });

  it("en pausa de Reproducir solo suenan las capas continuas", () => {
    const { ctx, engine, play, conductor } = setup({ transients: () => false });
    const cont = vi.spyOn(engine, "setContinuous");
    conductor.start();
    ctx.currentTime = 3;
    conductor.tick();
    expect(play).not.toHaveBeenCalled();
    expect(cont).toHaveBeenCalled();
  });

  it("con el contexto suspendido no planifica ni acumula atrasados", () => {
    const { ctx, play, conductor } = setup();
    conductor.start();
    play.mockClear();
    ctx.state = "suspended";
    ctx.currentTime = 100;
    conductor.tick();
    expect(play).not.toHaveBeenCalled();
    ctx.state = "running";
    conductor.tick();
    // salta al paso actual: nada con tiempo pasado
    for (const [, when] of play.mock.calls) expect(when).toBeGreaterThanOrEqual(100 - 1e-9);
  });

  it("stop() cancela el temporizador", () => {
    const ctx = new FakeContext();
    const clear = vi.fn();
    const conductor = createConductor({
      engine: createEngine(ctx, { wait: noWait }),
      readState: () => SILENT_STATE,
      rng: createRng(1),
      setTimer: () => 42,
      clearTimer: clear,
    });
    conductor.start();
    conductor.stop();
    expect(clear).toHaveBeenCalledWith(42);
  });
});

describe("contexto y arranque", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("no se crea ningún AudioContext hasta que se pide dentro del gesto", () => {
    const created = vi.fn();
    class Spy extends FakeContext {
      constructor() {
        super();
        created();
      }
    }
    vi.stubGlobal("AudioContext", Spy);
    // Importar y usar el motor con un contexto ajeno no crea nada.
    createEngine(new FakeContext(), { wait: noWait });
    expect(created).not.toHaveBeenCalled();
    // Solo al llamar a createUserContext (el manejador del clic).
    const ctx = createUserContext(window as never);
    expect(created).toHaveBeenCalledTimes(1);
    expect(ctx).toBeInstanceOf(Spy);
  });

  it("sin Web Audio devuelve null", () => {
    expect(createUserContext({})).toBeNull();
  });

  it("startAudio: suspende con la pestaña oculta, reanuda al volver y apaga limpio", async () => {
    const ctx = new FakeContext();
    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: false,
      addEventListener: (type: "visibilitychange", fn: () => void) => void listeners.set(type, fn),
      removeEventListener: (type: "visibilitychange") => void listeners.delete(type),
    };
    const store = { items: (): ReadonlyMap<string, LayerItem> => new Map() };
    vi.useFakeTimers();
    try {
      const handle = startAudio({ ctx, store, doc });
      expect(listeners.has("visibilitychange")).toBe(true);
      doc.hidden = true;
      listeners.get("visibilitychange")?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.state).toBe("suspended");
      doc.hidden = false;
      listeners.get("visibilitychange")?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.state).toBe("running");

      const stopping = handle.stop();
      await vi.advanceTimersByTimeAsync(500);
      await stopping;
      expect(listeners.has("visibilitychange")).toBe(false);
      expect(ctx.live()).toEqual([]);
      expect(ctx.closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0); // el planificador ya no corre
    } finally {
      vi.useRealTimers();
    }
  });
});
