import type { AddressInfo } from "node:net";
import {
  PULSE_DEFAULT_STEP_MS,
  PULSE_LAYER_MAX,
  PULSE_MAX_WINDOW_MS,
  PulseSchema,
} from "@pulso/schema";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, type ApiConfig } from "../src/config.js";
import {
  DAY_TYPES,
  DEFAULT_PULSE_WEIGHTS,
  FIXED_PROFILE,
  PULSE_LAYERS,
  activePulseLayers,
  computePulse,
  emptyAggregates,
  environmentRatio,
  expectedActivity,
  localSlot,
  parsePulseParams,
  parsePulseWeights,
  pulseCacheControl,
  pulseEtag,
  type PulseAggregates,
  type PulseWeights,
} from "../src/pulse.js";
import type { PulseQuery } from "../src/pulse-db.js";
import { FakeSource, testConfig } from "./helpers.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP = 5 * MIN;
/** Martes 2025-11-18 10:00 Europe/Madrid (CET, UTC+1) = 09:00 UTC: laborable, hora local 10 (forma 0,75). */
const TUE_10 = Date.UTC(2025, 10, 18, 9, 0, 0);
const only = (layer: (typeof PULSE_LAYERS)[number]): PulseWeights => {
  const w = Object.fromEntries(PULSE_LAYERS.map((l) => [l, 0])) as PulseWeights;
  w[layer] = 1;
  return w;
};
const input = (over: Partial<Parameters<typeof computePulse>[0]> = {}) => ({
  from: TUE_10,
  to: TUE_10 + HOUR,
  stepMs: STEP,
  weights: DEFAULT_PULSE_WEIGHTS,
  now: TUE_10 + DAY,
  ...over,
});
const agg = (over: Partial<PulseAggregates>): PulseAggregates => ({
  ...emptyAggregates(),
  ...over,
});

describe("parsePulseWeights", () => {
  it("sin valor = defaults; JSON parcial se mezcla; 0 desactiva", () => {
    expect(parsePulseWeights(undefined)).toEqual(DEFAULT_PULSE_WEIGHTS);
    expect(parsePulseWeights("  ")).toEqual(DEFAULT_PULSE_WEIGHTS);
    expect(parsePulseWeights('{"bus":2,"sea":0}')).toEqual({
      ...DEFAULT_PULSE_WEIGHTS,
      bus: 2,
      sea: 0,
    });
  });
  it("rechaza JSON roto, no objeto, capas desconocidas, pesos inválidos y todo a 0", () => {
    expect(() => parsePulseWeights("{")).toThrow(/JSON/);
    expect(() => parsePulseWeights("[1]")).toThrow(/objeto/);
    expect(() => parsePulseWeights('{"metro":1}')).toThrow(/desconocida/);
    expect(() => parsePulseWeights('{"bus":-1}')).toThrow(/entre 0 y 100/);
    expect(() => parsePulseWeights('{"bus":"2"}')).toThrow(/entre 0 y 100/);
    expect(() => parsePulseWeights('{"bus":1e999}')).toThrow();
    const allZero = JSON.stringify(Object.fromEntries(PULSE_LAYERS.map((l) => [l, 0])));
    expect(() => parsePulseWeights(allZero)).toThrow(/peso > 0/);
  });
  it("loadConfig lo valida al arrancar", () => {
    const env = { DATABASE_URL: "postgres://x@h/x" };
    expect(loadConfig({ ...env, PULSE_WEIGHTS: '{"bus":3}' }).pulseWeights.bus).toBe(3);
    expect(() => loadConfig({ ...env, PULSE_WEIGHTS: "nope" })).toThrow();
    expect(loadConfig(env).pulseWeights).toEqual(DEFAULT_PULSE_WEIGHTS);
  });
});

describe("perfil fijo y hora local", () => {
  it("día-tipo y hora en Europe/Madrid (invierno, verano y cambio de día)", () => {
    expect(localSlot(TUE_10)).toEqual({ dayType: "weekday", hour: 10 });
    expect(localSlot(Date.UTC(2025, 6, 15, 8, 0))).toEqual({ dayType: "weekday", hour: 10 }); // CEST
    expect(localSlot(Date.UTC(2025, 10, 22, 11, 0))).toEqual({ dayType: "saturday", hour: 12 });
    expect(localSlot(Date.UTC(2025, 10, 23, 11, 0))).toEqual({ dayType: "sunday", hour: 12 });
    // sábado 22:30 UTC de verano = domingo 00:30 en Madrid
    expect(localSlot(Date.UTC(2025, 6, 19, 22, 30))).toEqual({ dayType: "sunday", hour: 0 });
    // lunes 23:30 UTC de invierno = martes 00:30
    expect(localSlot(Date.UTC(2025, 10, 17, 23, 30))).toEqual({ dayType: "weekday", hour: 0 });
  });
  it("las tablas tienen 24 horas por día-tipo, en [0,1]", () => {
    for (const layer of ["bus", "bike", "ship", "plane"] as const)
      for (const d of DAY_TYPES) {
        const s = FIXED_PROFILE.shape[layer][d];
        expect(s).toHaveLength(24);
        expect(s.every((v) => v >= 0 && v <= 1)).toBe(true);
      }
  });
  it("lo habitual cae de madrugada y en domingo respecto al laborable", () => {
    expect(expectedActivity("bus", TUE_10)).toBeCloseTo(30);
    expect(expectedActivity("bus", TUE_10 - 7 * HOUR)).toBeLessThan(3); // 03:00
    expect(expectedActivity("bus", TUE_10 + 5 * DAY)).toBeLessThan(expectedActivity("bus", TUE_10));
  });
});

describe("computePulse", () => {
  const busOnly = { weights: only("bus") };
  const moving = (n: number, idx = 0) => ({ layer: "bus" as const, idx, moving: n });

  it("lo habitual = 50; el doble o más = 100; nada ≈ 0", () => {
    const at = (n: number) => computePulse(input(busOnly), agg({ mobile: [moving(n)] })).points[0];
    // habitual a las 10 h = 30 en movimiento; el suavizado (+1) da exactamente 50 en lo habitual
    expect(at(30)?.value).toBe(50);
    expect(at(29)?.value).toBeCloseTo(48.4, 1);
    expect(at(29)?.layers.bus).toBeCloseTo(0.97, 2);
    expect(at(60)?.value).toBeCloseTo(98.4, 1);
    expect(at(500)?.value).toBe(100);
    expect(at(500)?.layers.bus).toBe(PULSE_LAYER_MAX);
    expect(at(0)?.value).toBeCloseTo(1.6, 1);
  });

  it("devuelve un punto por tramo con datos, alineado a from, perfil fijo y válido con el esquema", () => {
    const a = agg({ mobile: [moving(30, 0), moving(10, 3)] });
    const r = computePulse(input(busOnly), a);
    // capa viva en la ventana: los tramos sin filas cuentan como 0 en movimiento
    expect(r.points).toHaveLength(HOUR / STEP);
    expect(r.points.map((p) => p.ts)).toEqual(
      Array.from({ length: HOUR / STEP }, (_, i) => TUE_10 + i * STEP),
    );
    expect(r.points[3]?.value).toBeLessThan(r.points[0]?.value ?? 0);
    expect(r.profile).toBe("fixed");
    expect(PulseSchema.safeParse(r).success).toBe(true);
  });

  it("sin datos en toda la ventana: sin puntos (sin datos ≠ actividad 0)", () => {
    const r = computePulse(input(), emptyAggregates());
    expect(r.points).toEqual([]);
    expect(PulseSchema.safeParse(r).success).toBe(true);
    // una capa muerta se omite y las vivas siguen contando
    const only2 = computePulse(input(), agg({ bike: [{ idx: 0, rotation: 25 }], mobile: [] }));
    expect(Object.keys(only2.points[0]?.layers ?? {})).toEqual(["bike"]);
  });

  it("media ponderada: los pesos reparten la influencia", () => {
    const a = agg({
      mobile: [moving(60), { layer: "ship", idx: 0, moving: 0 }],
    });
    const heavyBus = computePulse(input({ weights: { ...only("bus"), ship: 0.1 } }), a);
    const heavyShip = computePulse(input({ weights: { ...only("ship"), bus: 0.1 } }), a);
    expect(heavyBus.points[0]?.value).toBeGreaterThan(heavyShip.points[0]?.value ?? 100);
    // peso 0: la capa no aparece
    const noShip = computePulse(input({ weights: { ...only("bus") } }), a);
    expect(noShip.points[0]?.layers.ship).toBeUndefined();
  });

  it("bicis: rotación normalizada a 5 min y extrapolación del tramo en curso", () => {
    const w = only("bike");
    // pico de laborable a las 10 h: 25 × 0,75 = 18,75 cambios/5 min
    const full = computePulse(input({ weights: w }), agg({ bike: [{ idx: 0, rotation: 18 }] }));
    expect(full.points[0]?.layers.bike).toBeCloseTo(19 / 19.75, 2);
    // paso de 10 min con 36 cambios = 18 por 5 min
    const wide = computePulse(
      input({ weights: w, stepMs: 10 * MIN }),
      agg({ bike: [{ idx: 0, rotation: 36 }] }),
    );
    expect(wide.points[0]?.layers.bike).toBeCloseTo(full.points[0]?.layers.bike ?? 0, 2);
    // tramo en curso: pasaron 2,5 min de 5 → se duplica; no hay puntos futuros
    const live = computePulse(
      input({ weights: w, now: TUE_10 + 2.5 * MIN }),
      agg({ bike: [{ idx: 0, rotation: 9 }] }),
    );
    expect(live.points).toHaveLength(1);
    expect(live.points[0]?.layers.bike).toBeCloseTo(full.points[0]?.layers.bike ?? 0, 2);
    // menos de un minuto transcurrido: no se extrapola (capa omitida, sin punto)
    const tooEarly = computePulse(
      input({ weights: w, now: TUE_10 + 20_000 }),
      agg({ bike: [{ idx: 0, rotation: 1 }] }),
    );
    expect(tooEarly.points).toEqual([]);
  });

  it("capas ambientales: desviación acotada, no dominan", () => {
    expect(environmentRatio("weather", [{ metric: "wind_speed", avg: 4 }])).toBe(1);
    expect(environmentRatio("weather", [{ metric: "wind_speed", avg: 400 }])).toBe(1.5);
    expect(environmentRatio("air", [{ metric: "pm10", avg: -50 }])).toBe(0.5);
    expect(environmentRatio("sea", [{ metric: "desconocida", avg: 9 }])).toBeUndefined();
    // un temporal extremo con el tráfico en lo habitual sube el índice solo unos puntos
    const base = agg({ mobile: [moving(30)], bike: [{ idx: 0, rotation: 19 }] });
    const calm = computePulse(input(), base).points[0]?.value ?? 0;
    const storm = computePulse(
      input(),
      agg({
        ...base,
        obs: [
          { layer: "weather", metric: "wind_speed", idx: 0, avg: 60 },
          { layer: "air", metric: "pm10", idx: 0, avg: 500 },
          { layer: "sea", metric: "tide_level", idx: 0, avg: 9 },
        ],
      }),
    ).points[0];
    expect(storm?.value ?? 0).toBeGreaterThan(calm);
    expect((storm?.value ?? 0) - calm).toBeLessThan(8);
    for (const l of ["weather", "air", "sea"] as const)
      expect(storm?.layers[l]).toBeLessThanOrEqual(1.5);
  });

  it("solo ambiental también produce punto (capas presentes renormalizan los pesos)", () => {
    const r = computePulse(
      input(),
      agg({ obs: [{ layer: "weather", metric: "wind_speed", idx: 1, avg: 4 }] }),
    );
    expect(r.points.map((p) => [p.ts, p.value])).toEqual([[TUE_10 + STEP, 50]]);
  });

  it("valor con un decimal siempre y dentro de 0–100", () => {
    for (const n of [0, 1, 7, 13, 31, 44, 99, 1000]) {
      const p = computePulse(input(), agg({ mobile: [moving(n)] })).points[0];
      expect(p?.value).toBeGreaterThanOrEqual(0);
      expect(p?.value).toBeLessThanOrEqual(100);
      expect(Math.abs((p?.value ?? 0) * 10 - Math.round((p?.value ?? 0) * 10))).toBeLessThan(1e-6);
    }
  });

  it("la forma del día-tipo desplaza «lo habitual»: la misma actividad pesa más en domingo", () => {
    const sunday = TUE_10 + 5 * DAY;
    const a = agg({ mobile: [moving(20)] });
    const tue = computePulse(input(busOnly), a).points[0]?.value ?? 0;
    const sun =
      computePulse(input({ ...busOnly, from: sunday, to: sunday + HOUR, now: sunday + DAY }), a)
        .points[0]?.value ?? 0;
    expect(sun).toBeGreaterThan(tue);
  });
});

describe("parsePulseParams", () => {
  const NOW = Date.UTC(2025, 10, 20, 12, 0);
  const q = (o: Record<string, string> = {}) => ({
    from: String(NOW - 2 * HOUR),
    to: String(NOW),
    ...o,
  });
  const parse = (o: Record<string, unknown>) => parsePulseParams(o, NOW, 365);

  it("acepta una ventana válida con el paso por defecto o explícito", () => {
    expect(parse(q())).toEqual({
      ok: true,
      params: { from: NOW - 2 * HOUR, to: NOW, stepMs: PULSE_DEFAULT_STEP_MS },
    });
    expect(parse(q({ step: String(15 * MIN) }))).toMatchObject({
      ok: true,
      params: { stepMs: 15 * MIN },
    });
    expect(parse(q({ from: String(NOW - PULSE_MAX_WINDOW_MS) }))).toMatchObject({ ok: true });
  });
  it("permite que `to` esté en el futuro (tramos sin datos no generan puntos)", () => {
    expect(parse(q({ to: String(NOW + HOUR) })).ok).toBe(true);
  });
  it("rechaza lo inválido con mensaje", () => {
    const bad = (o: Record<string, unknown>) => {
      const r = parse(o);
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(bad({})).toMatch(/from/);
    expect(bad({ from: "abc", to: "1" })).toMatch(/from/);
    expect(bad(q({ to: "x" }))).toMatch(/to/);
    expect(bad(q({ from: "1760000000" }))).toMatch(/milisegundos/); // segundos
    expect(bad(q({ to: String(NOW - 2 * HOUR) }))).toMatch(/mayor/);
    expect(bad(q({ from: String(NOW - 25 * HOUR) }))).toMatch(/24 h/);
    expect(bad(q({ from: String(NOW + MIN), to: String(NOW + 2 * MIN) }))).toMatch(/futuro/);
    expect(bad(q({ from: String(NOW - 400 * DAY), to: String(NOW - 399 * DAY) }))).toMatch(/365/);
    expect(bad(q({ step: "30000" }))).toMatch(/step/);
    expect(bad(q({ step: String(2 * HOUR) }))).toMatch(/step/);
    expect(bad(q({ step: "90000" }))).toMatch(/múltiplo/);
    expect(bad(q({ step: "5min" }))).toMatch(/step/);
    expect(bad({ ...q(), step: ["60000", "120000"] })).toMatch(/step/);
    expect(bad({ ...q(), from: ["1", "2"] })).toMatch(/from/);
  });
});

describe("caché HTTP", () => {
  const NOW = Date.now();
  it("TTL según frescura", () => {
    expect(pulseCacheControl({ to: NOW + MIN, now: NOW, empty: false })).toBe("public, max-age=30");
    expect(pulseCacheControl({ to: NOW - MIN, now: NOW, empty: false })).toBe("public, max-age=60");
    expect(pulseCacheControl({ to: NOW - DAY, now: NOW, empty: true })).toBe("public, max-age=60");
    expect(pulseCacheControl({ to: NOW - DAY, now: NOW, empty: false })).toBe(
      "public, max-age=3600",
    );
  });
  it("ETag estable para el mismo cuerpo", () => {
    expect(pulseEtag("a")).toBe(pulseEtag("a"));
    expect(pulseEtag("a")).not.toBe(pulseEtag("b"));
    expect(pulseEtag("a")).toMatch(/^"[\w-]{22}"$/);
  });
  it("activePulseLayers omite capas con peso 0", () => {
    expect(activePulseLayers({ ...DEFAULT_PULSE_WEIGHTS, sea: 0, ship: 0 })).toEqual([
      "bus",
      "bike",
      "weather",
      "air",
      "plane",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// HTTP con fuente en memoria
// ---------------------------------------------------------------------------------------------

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) await a.close();
});

async function start(
  over: Partial<ApiConfig> = {},
  src = new FakeSource(),
): Promise<{ src: FakeSource; base: string }> {
  const { app } = await buildApp(testConfig(over), src);
  open.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  return { src, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
const url = (base: string, from: number, to: number, extra = ""): string =>
  `${base}/api/v1/pulse?from=${from}&to=${to}${extra}`;

describe("GET /api/v1/pulse", () => {
  const NOW = Date.now();
  const FROM = Math.floor((NOW - 6 * HOUR) / STEP) * STEP;
  const TO = FROM + 2 * HOUR;
  const seed = (src: FakeSource): void => {
    src.pulseAgg = {
      mobile: [{ layer: "bus", idx: 0, moving: 20 }],
      bike: [{ idx: 1, rotation: 10 }],
      obs: [{ layer: "weather", metric: "wind_speed", idx: 0, avg: 6 }],
    };
  };

  it("200 JSON válido con ETag, Cache-Control y capas/corte pasados a la BD", async () => {
    const { src, base } = await start();
    seed(src);
    const r = await fetch(url(base, FROM, TO));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(r.headers.get("etag")).toMatch(/^"[\w-]{22}"$/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const pulse = PulseSchema.parse(await r.json());
    expect(pulse).toMatchObject({ from: FROM, to: TO, stepMs: STEP, profile: "fixed" });
    expect(pulse.points.length).toBe((2 * HOUR) / STEP);
    expect(pulse.points[0]?.layers).toHaveProperty("bus");
    const call = src.pulseCalls[0] as PulseQuery;
    expect(call).toMatchObject({ from: FROM, to: TO, stepMs: STEP });
    expect(call.layers).toEqual(activePulseLayers(DEFAULT_PULSE_WEIGHTS));
    expect(call.cutoff % MIN).toBe(0);
  });

  it("respeta step y los pesos configurados (capa a 0 no se lee)", async () => {
    const { src, base } = await start({ pulseWeights: { ...DEFAULT_PULSE_WEIGHTS, sea: 0 } });
    seed(src);
    const r = await fetch(url(base, FROM, TO, `&step=${15 * MIN}`));
    expect(PulseSchema.parse(await r.json()).stepMs).toBe(15 * MIN);
    expect(src.pulseCalls[0]?.layers).not.toContain("sea");
  });

  it("If-None-Match → 304 sin cuerpo", async () => {
    const { src, base } = await start();
    seed(src);
    const etag = (await fetch(url(base, FROM, TO))).headers.get("etag") ?? "";
    const r = await fetch(url(base, FROM, TO), { headers: { "If-None-Match": etag } });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect(r.headers.get("etag")).toBe(etag);
  });

  it("ventana que incluye «ahora» → TTL corto; sin datos → 1 min", async () => {
    const { src, base } = await start();
    seed(src);
    const live = await fetch(url(base, NOW - HOUR, NOW + MIN));
    expect(live.headers.get("cache-control")).toBe("public, max-age=30");
    src.pulseAgg = emptyAggregates();
    const empty = await fetch(url(base, FROM, TO));
    expect(empty.headers.get("cache-control")).toBe("public, max-age=60");
    expect(PulseSchema.parse(await empty.json()).points).toEqual([]);
  });

  it("400 sin tocar la BD; errores no cacheables", async () => {
    const { src, base } = await start();
    for (const u of [
      `${base}/api/v1/pulse`,
      url(base, FROM, FROM),
      url(base, FROM, FROM + PULSE_MAX_WINDOW_MS + 1),
      url(base, FROM, TO, "&step=1000"),
      url(base, FROM, TO, "&step=abc"),
      url(base, Math.floor(FROM / 1000), Math.floor(TO / 1000)),
    ]) {
      const r = await fetch(u);
      expect(r.status).toBe(400);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toMatchObject({ error: "bad_request" });
    }
    expect(src.pulseCalls).toHaveLength(0);
  });

  it("503 si la BD no responde", async () => {
    const { src, base } = await start();
    src.failing = true;
    const r = await fetch(url(base, FROM, TO));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("5");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("limita las lecturas simultáneas por IP (429), une las idénticas y libera al terminar", async () => {
    const { src, base } = await start({ pulseMaxPerIp: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = src.pulse.bind(src);
    src.pulse = async (q: PulseQuery) => {
      await gate;
      return real(q);
    };
    const first = fetch(url(base, FROM, TO));
    const twin = fetch(url(base, FROM, TO)); // misma clave: comparte la consulta
    await new Promise((r) => setTimeout(r, 100));
    const other = await fetch(url(base, FROM, TO - HOUR));
    expect(other.status).toBe(429);
    expect(other.headers.get("retry-after")).toBe("2");
    release();
    expect((await first).status).toBe(200);
    expect((await twin).status).toBe(200);
    expect(src.pulseCalls).toHaveLength(1);
    expect((await fetch(url(base, FROM, TO - HOUR))).status).toBe(200);
  });

  it("tope global de lecturas simultáneas (429)", async () => {
    const { src, base } = await start({ pulseMaxPerIp: 5, pulseMaxGlobal: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = src.pulse.bind(src);
    src.pulse = async (q: PulseQuery) => {
      await gate;
      return real(q);
    };
    const first = fetch(url(base, FROM, TO));
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(url(base, FROM, TO - HOUR))).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });
});
