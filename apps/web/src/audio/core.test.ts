import type { LayerId, LayerItem } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { BPM, STEP_SEC, createRng, quantizeToStep, stepIndexAt, stepTime } from "./grid";
import { PENTATONIC, degreeToMidi, hzInScale, isInScale, midiToHz } from "./scale";
import { planStep, type MusicEvent } from "./score";
import { SILENT_STATE, readSoundState, type SoundState } from "./state";
import { MAX_VOICES, VoicePool } from "./voices";

describe("rejilla", () => {
  it("corcheas a 90 bpm", () => {
    expect(BPM).toBe(90);
    expect(STEP_SEC).toBeCloseTo(1 / 3, 10);
  });

  it("cuantiza al siguiente paso, sin mover lo que ya está en la rejilla", () => {
    expect(quantizeToStep(1.0, 0)).toBeCloseTo(1.0, 9);
    expect(quantizeToStep(1.01, 0)).toBeCloseTo(4 / 3, 9);
    expect(quantizeToStep(0.2, 10)).toBe(10);
    expect(quantizeToStep(10.4, 10)).toBeCloseTo(10 + 2 / 3, 9);
    expect(stepIndexAt(1.01, 0)).toBe(4);
    expect(stepTime(3, 2)).toBeCloseTo(3, 9);
  });

  it("el RNG con semilla es determinista y está en [0, 1)", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("escala pentatónica", () => {
  it("los grados caen en la escala, también negativos y de otras octavas", () => {
    for (let d = -15; d <= 20; d++) expect(isInScale(degreeToMidi(d))).toBe(true);
    expect(degreeToMidi(0)).toBe(57);
    expect(degreeToMidi(5)).toBe(69);
    expect(degreeToMidi(-1)).toBe(55);
    expect(PENTATONIC).toHaveLength(5);
  });

  it("una nota fuera de la escala no lo es", () => {
    expect(isInScale(58)).toBe(false);
    expect(isInScale(61)).toBe(false);
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(hzInScale(440)).toBe(true);
    expect(hzInScale(450)).toBe(false);
  });
});

const busy: SoundState = {
  bus: { count: 40 },
  bike: { stations: 20, availability: 0.3 },
  sea: { tide: 0.5 },
  wind: { speed: 8 },
  air: { level: 3 },
  ship: { count: 10 },
  plane: { count: 10 },
};

function collect(state: SoundState, steps: number, seed = 1): MusicEvent[] {
  const rng = createRng(seed);
  const out: MusicEvent[] = [];
  for (let s = 0; s < steps; s++) out.push(...planStep(state, s, rng));
  return out;
}

describe("partitura (estado → eventos)", () => {
  it("sin datos no suena nada; en pausa (transients=false) tampoco", () => {
    expect(collect(SILENT_STATE, 200)).toEqual([]);
    expect(planStep(busy, 0, createRng(1), { transients: false })).toEqual([]);
  });

  it("es determinista", () => {
    expect(collect(busy, 100, 3)).toEqual(collect(busy, 100, 3));
  });

  it("todas las notas melódicas están en la pentatónica y en su paso", () => {
    const events = collect(busy, 400);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      if (e.kind !== "hat") expect(hzInScale(e.freq), `${e.layer}:${e.kind}`).toBe(true);
      expect(Number.isInteger(e.step)).toBe(true);
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(0.25);
    }
  });

  it("cada capa tiene su timbre", () => {
    const events = collect(busy, 800);
    const kindsOf = (layer: string) =>
      new Set(events.filter((e) => e.layer === layer).map((e) => e.kind));
    expect(kindsOf("bus")).toEqual(new Set(["note"]));
    expect(kindsOf("bike")).toEqual(new Set(["kick", "hat"]));
    expect(kindsOf("ship")).toEqual(new Set(["horn"]));
    expect(kindsOf("plane")).toEqual(new Set(["sweep"]));
    expect(kindsOf("air")).toEqual(new Set(["bell"]));
  });

  it("los autobuses son agudos y breves; los acentos, escasos", () => {
    const events = collect(busy, 800);
    const buses = events.filter((e) => e.layer === "bus");
    expect(Math.min(...buses.map((e) => e.freq))).toBeGreaterThan(400);
    expect(Math.max(...buses.map((e) => e.dur))).toBeLessThanOrEqual(0.2);
    const accents = events.filter((e) => ["ship", "plane", "air"].includes(e.layer));
    expect(accents.length).toBeLessThan(events.length * 0.15);
  });

  it("más actividad, más densidad", () => {
    const few = collect({ ...busy, bus: { count: 2 } }, 800).filter((e) => e.layer === "bus");
    const many = collect({ ...busy, bus: { count: 60 } }, 800).filter((e) => e.layer === "bus");
    expect(many.length).toBeGreaterThan(few.length);
  });
});

describe("lectura del almacén", () => {
  const reader = (data: Partial<Record<LayerId, LayerItem[]>>) => ({
    items: (layer: LayerId) =>
      new Map<string, LayerItem>(
        (data[layer] ?? []).map((item, i) => [String("id" in item ? item.id : i), item]),
      ),
  });
  const ts = 1_760_000_000_000;

  it("vacío → estado silencioso", () => {
    expect(readSoundState(reader({}))).toEqual({
      ...SILENT_STATE,
      bike: { stations: 0, availability: 0.5 },
    });
  });

  it("deriva bici, marea, viento, aire y móviles", () => {
    const state = readSoundState(
      reader({
        bus: [{ id: "b1", layer: "bus", lon: -8.4, lat: 43.3, ts }],
        bike: [{ id: "s1", layer: "bike", lon: -8.4, lat: 43.3, bikes: 3, docks: 9, ts }],
        sea: [{ stationId: "x", layer: "sea", metric: "tide_level", value: 2.5, unit: "m", ts }],
        weather: [
          { stationId: "a", layer: "weather", metric: "wind_speed", value: 4, unit: "m/s", ts },
          { stationId: "b", layer: "weather", metric: "wind_speed", value: 8, unit: "m/s", ts },
        ],
        air: [{ stationId: "m", layer: "air", metric: "european_aqi", value: 45, unit: "", ts }],
        ship: [
          { id: "s1", layer: "ship", lon: -8.4, lat: 43.3, speed: 5, ts },
          { id: "s2", layer: "ship", lon: -8.4, lat: 43.3, speed: 0, ts },
        ],
        plane: [{ id: "p1", layer: "plane", lon: -8.4, lat: 43.3, ts }],
      }),
    );
    expect(state.bus.count).toBe(1);
    expect(state.bike).toEqual({ stations: 1, availability: 0.25 });
    expect(state.sea.tide).toBeCloseTo(0.5, 9);
    expect(state.wind.speed).toBe(6);
    expect(state.air.level).toBe(3);
    expect(state.ship.count).toBe(1);
    expect(state.plane.count).toBe(1);
  });
});

describe("reserva de voces", () => {
  it("nunca pasa de 16, aunque se pidan muchas", () => {
    const pool = new VoicePool();
    for (let i = 0; i < 100; i++) {
      pool.acquire(2 + (i % 3), i, i + 10);
      expect(pool.size).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(pool.size).toBe(MAX_VOICES);
  });

  it("roba la de menor prioridad y, a igual prioridad, la más antigua", () => {
    const pool = new VoicePool(3);
    const a = pool.acquire(2, 1, 100);
    const b = pool.acquire(2, 2, 100);
    const c = pool.acquire(5, 3, 100);
    expect(a && b && c).toBeTruthy();
    const d = pool.acquire(2, 4, 100);
    expect(d?.stolen).toBe(a?.id);
    const e = pool.acquire(3, 5, 100);
    expect(e?.stolen).toBe(b?.id);
    expect(pool.size).toBe(3);
  });

  it("descarta la petición si todas las voces tienen más prioridad", () => {
    const pool = new VoicePool(2);
    pool.acquire(100, 0, Infinity);
    pool.acquire(100, 0, Infinity);
    expect(pool.acquire(2, 1, 2)).toBeNull();
    expect(pool.size).toBe(2);
  });

  it("libera lo caducado y lo liberado explícitamente", () => {
    const pool = new VoicePool(2);
    const a = pool.acquire(2, 0, 1);
    pool.acquire(2, 0, 5);
    expect(pool.expire(1)).toEqual([a?.id]);
    expect(pool.size).toBe(1);
    pool.release(2);
    expect(pool.size).toBe(0);
  });
});
