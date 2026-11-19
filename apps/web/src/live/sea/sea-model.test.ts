import { describe, expect, it } from "vitest";
import { T0, tide } from "../test-helpers";
import {
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_SAMPLES,
  TideHistory,
  readTide,
  type TideSample,
} from "./history";
import { haloDiscs, haloRadius, lineAlpha } from "./halo";
import {
  REF_MAX,
  REF_MIN,
  TREND_MAX_AGE_MS,
  levelFraction,
  seaView,
  tideSlope,
  tideTrend,
} from "./model";

const MIN = 60_000;
/** Lecturas cada `step` min desde T0 con una pendiente en m/h. */
function ramp(count: number, perHour: number, start = 2.5, step = 5): TideSample[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: T0 + i * step * MIN,
    value: start + (perHour * i * step) / 60,
  }));
}

describe("readTide", () => {
  it("lee el nivel del mareógrafo", () => {
    expect(readTide([tide(3.5, T0 + 1)])).toEqual({ ts: T0 + 1, value: 3.5 });
  });

  it("ignora otras estaciones, métricas, unidades y valores no válidos", () => {
    expect(readTide([tide(3, T0, { stationId: "otra" })])).toBeUndefined();
    expect(readTide([tide(3, T0, { metric: "wave_height" })])).toBeUndefined();
    expect(readTide([tide(3, T0, { unit: "cm" })])).toBeUndefined();
    expect(readTide([tide(Number.NaN)])).toBeUndefined();
    expect(readTide([tide(99)])).toBeUndefined();
    expect(readTide([tide(-9)])).toBeUndefined();
    expect(readTide([])).toBeUndefined();
  });
});

describe("TideHistory", () => {
  it("guarda en orden, sin repetidos ni lecturas atrasadas", () => {
    const h = new TideHistory();
    expect(h.record({ ts: 10, value: 1 })).toBe(true);
    expect(h.record({ ts: 10, value: 1 })).toBe(false);
    expect(h.record({ ts: 5, value: 9 })).toBe(false);
    expect(h.record({ ts: 20, value: 2 })).toBe(true);
    expect(h.samples.map((s) => s.ts)).toEqual([10, 20]);
    expect(h.latest?.value).toBe(2);
  });

  it("corrige el valor del mismo instante", () => {
    const h = new TideHistory();
    h.record({ ts: 10, value: 1 });
    expect(h.record({ ts: 10, value: 1.5 })).toBe(true);
    expect(h.samples).toEqual([{ ts: 10, value: 1.5 }]);
  });

  it("acota por antigüedad y por número", () => {
    const h = new TideHistory();
    h.record({ ts: T0, value: 1 });
    h.record({ ts: T0 + HISTORY_MAX_AGE_MS + MIN, value: 2 });
    expect(h.samples).toHaveLength(1);
    const many = new TideHistory();
    for (let i = 0; i < HISTORY_MAX_SAMPLES + 20; i++) many.record({ ts: T0 + i * 1000, value: 1 });
    expect(many.samples).toHaveLength(HISTORY_MAX_SAMPLES);
  });
});

describe("levelFraction", () => {
  it("usa el rango de referencia sin historia", () => {
    expect(levelFraction(REF_MIN, [])).toBe(0);
    expect(levelFraction(REF_MAX, [])).toBe(1);
    expect(levelFraction((REF_MIN + REF_MAX) / 2, [])).toBeCloseTo(0.5, 6);
  });

  it("se amplía con los extremos de la sesión y nunca sale de [0, 1]", () => {
    const history = [
      { ts: 1, value: -0.2 },
      { ts: 2, value: 4.6 },
    ];
    expect(levelFraction(-0.2, history)).toBe(0);
    expect(levelFraction(4.6, history)).toBe(1);
    const mid = levelFraction(2.2, history);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(levelFraction(10, [])).toBe(1);
    expect(levelFraction(-3, [])).toBe(0);
  });
});

describe("tendencia", () => {
  it("sube, baja o estable según la pendiente", () => {
    const now = T0 + 40 * MIN;
    expect(tideTrend(ramp(9, 0.6), now)).toBe("rising");
    expect(tideTrend(ramp(9, -0.6), now)).toBe("falling");
    expect(tideTrend(ramp(9, 0.02), now)).toBe("steady");
    expect(tideSlope(ramp(9, 0.6), now)).toBeCloseTo(0.6, 6);
  });

  it("no la inventa con pocas lecturas o muy juntas", () => {
    expect(tideTrend([], T0)).toBeNull();
    expect(tideTrend(ramp(2, 0.6), T0 + 5 * MIN)).toBeNull();
    expect(tideTrend(ramp(3, 0.6, 2.5, 2), T0 + 4 * MIN)).toBeNull(); // 4 min de arco
    expect(tideTrend(ramp(3, 0.6, 2.5, 5), T0 + 10 * MIN)).toBe("rising");
  });

  it("deja de conocerse si la última lectura es vieja", () => {
    const h = ramp(9, 0.6);
    const last = (h[h.length - 1] as TideSample).ts;
    expect(tideTrend(h, last + TREND_MAX_AGE_MS)).toBe("rising");
    expect(tideTrend(h, last + TREND_MAX_AGE_MS + 1)).toBeNull();
  });

  it("solo mira la última hora", () => {
    // 2 h bajando y la última hora subiendo: manda la última hora.
    const down = ramp(24, -0.5);
    const lastDown = down[down.length - 1] as TideSample;
    const up = ramp(13, 0.5, lastDown.value).map((s) => ({
      ts: s.ts + lastDown.ts,
      value: s.value,
    }));
    const h = [...down, ...up.slice(1)];
    expect(tideTrend(h, (h[h.length - 1] as TideSample).ts)).toBe("rising");
  });
});

describe("seaView", () => {
  it("sin lecturas no hay vista", () => {
    expect(seaView([], T0)).toBeNull();
  });

  it("junta nivel, fracción y tendencia", () => {
    const h = ramp(9, 0.6);
    const last = h[h.length - 1] as TideSample;
    const view = seaView(h, last.ts);
    expect(view?.value).toBe(last.value);
    expect(view?.ts).toBe(last.ts);
    expect(view?.trend).toBe("rising");
    expect(view?.fraction).toBeGreaterThan(0);
  });
});

describe("halo", () => {
  it("crece y se ilumina con el nivel", () => {
    expect(haloRadius(1)).toBeGreaterThan(haloRadius(0));
    const low = haloDiscs(0);
    const high = haloDiscs(1);
    expect(high[high.length - 1]?.radius).toBe(haloRadius(1));
    expect(high[0]?.alpha).toBeGreaterThan(low[0]?.alpha ?? 0);
    expect(lineAlpha(1)).toBeGreaterThan(lineAlpha(0));
  });

  it("discos concéntricos crecientes y fracciones fuera de rango recortadas", () => {
    const d = haloDiscs(0.5);
    for (let i = 1; i < d.length; i++) {
      expect(d[i]?.radius).toBeGreaterThan(d[i - 1]?.radius ?? 0);
    }
    expect(haloRadius(5)).toBe(haloRadius(1));
    expect(haloRadius(-5)).toBe(haloRadius(0));
  });
});
