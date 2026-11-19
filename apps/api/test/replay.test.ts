import type { AddressInfo } from "node:net";
import { decode, encode } from "@msgpack/msgpack";
import {
  REPLAY_COORD_SCALE,
  REPLAY_WINDOW_MS,
  ReplayWindowSchema,
  type ReplayWindow,
} from "@pulso/schema";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import {
  ReplayCache,
  buildReplayWindow,
  etagMatches,
  isAlignedWindow,
  isEmptyWindow,
  parseReplayParams,
  replayCacheControl,
  replayEtag,
  replayResolution,
} from "../src/replay.js";
import { emptyReplayRows, type ReplayQuery, type ReplayRows } from "../src/replay-db.js";
import { FakeSource, testConfig } from "./helpers.js";

const W = REPLAY_WINDOW_MS;
const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.now();
/** Ventana alineada de hace ~2 h (asentada). */
const PAST = Math.floor((NOW - 2 * 60 * MIN) / W) * W;

const pos = (id: string, ts: number, over: Record<string, unknown> = {}) => ({
  id,
  layer: "bus" as const,
  ts,
  lon: -8.4,
  lat: 43.36,
  heading: null,
  speed: null,
  meta: null,
  ...over,
});

describe("parseReplayParams", () => {
  const q = (o: Record<string, string>) => ({ from: String(PAST), to: String(PAST + W), ...o });
  const parse = (o: Record<string, unknown>) => parseReplayParams(o, NOW, 30);

  it("acepta una ventana válida y ordena las capas de forma canónica", () => {
    const r = parse(q({ layers: "weather,bus,bus,bike" }));
    expect(r).toEqual({
      ok: true,
      params: { from: PAST, to: PAST + W, layers: ["bus", "bike", "weather"] },
    });
  });
  it("sin layers = todas", () => {
    const r = parse(q({}));
    expect(r.ok && r.params.layers).toHaveLength(8);
  });
  it("rechaza ventanas mayores de 5 min, vacías o invertidas", () => {
    expect(parse(q({ to: String(PAST + W + 1) }))).toMatchObject({ ok: false });
    expect(parse(q({ to: String(PAST) }))).toMatchObject({ ok: false });
    expect(parse(q({ to: String(PAST - 1) }))).toMatchObject({ ok: false });
  });
  it("rechaza from/to ausentes, no numéricos o en segundos", () => {
    expect(parse({ to: String(PAST) })).toMatchObject({ ok: false });
    expect(parse(q({ from: "ayer" }))).toMatchObject({ ok: false });
    expect(parse(q({ from: "-5" }))).toMatchObject({ ok: false });
    expect(parse(q({ from: "1.5" }))).toMatchObject({ ok: false });
    expect(parse({ from: "1760000000", to: "1760000300" })).toMatchObject({ ok: false });
    expect(parse({ from: [String(PAST)], to: String(PAST + W) })).toMatchObject({ ok: false });
  });
  it("rechaza capas desconocidas o vacías", () => {
    expect(parse(q({ layers: "bus,metro" }))).toMatchObject({ ok: false });
    expect(parse(q({ layers: "" }))).toMatchObject({ ok: false });
  });
  it("rechaza from en el futuro o más antiguo que el histórico", () => {
    expect(parse(q({ from: String(NOW + MIN), to: String(NOW + 2 * MIN) }))).toMatchObject({
      ok: false,
    });
    const old = NOW - 31 * DAY;
    expect(parse({ from: String(old), to: String(old + W) })).toMatchObject({ ok: false });
    const edge = NOW - 29 * DAY;
    expect(parse({ from: String(edge), to: String(edge + W) })).toMatchObject({ ok: true });
  });
  it("permite una ventana que termina en el futuro (la actual)", () => {
    const from = NOW - MIN;
    expect(parse({ from: String(from), to: String(from + W) })).toMatchObject({ ok: true });
  });
});

describe("resolución y caché", () => {
  it("raw dentro de los días con brutos, 1m más atrás", () => {
    expect(replayResolution(NOW - DAY, NOW, 28)).toBe("raw");
    expect(replayResolution(NOW - 27 * DAY, NOW, 28)).toBe("raw");
    expect(replayResolution(NOW - 29 * DAY, NOW, 28)).toBe("1m");
  });
  it("alineación", () => {
    expect(isAlignedWindow(PAST, PAST + W)).toBe(true);
    expect(isAlignedWindow(PAST + 1000, PAST + W + 1000)).toBe(false);
    expect(isAlignedWindow(PAST, PAST + MIN)).toBe(false);
  });
  const cc = (from: number, to: number, over = {}) =>
    replayCacheControl({ from, to, now: NOW, resolution: "raw", empty: false, ...over });
  it("ventana actual: TTL corto; reciente o vacía: 1 min", () => {
    expect(cc(NOW - MIN, NOW + 4 * MIN)).toBe("public, max-age=10");
    const recent = Math.floor((NOW - 6 * MIN) / W) * W;
    expect(cc(recent, recent + W)).toBe("public, max-age=60");
    expect(cc(PAST, PAST + W, { empty: true })).toBe("public, max-age=60");
  });
  it("pasada y alineada: inmutable; no alineada: 1 h", () => {
    expect(cc(PAST, PAST + W)).toBe("public, max-age=86400, immutable");
    expect(cc(PAST, PAST + W, { resolution: "1m" })).toBe("public, max-age=31536000, immutable");
    expect(cc(PAST + 1000, PAST + 1000 + MIN)).toBe("public, max-age=3600");
  });
  it("ETag estable y comparación de If-None-Match", () => {
    const a = replayEtag(new Uint8Array([1, 2, 3]));
    expect(a).toBe(replayEtag(new Uint8Array([1, 2, 3])));
    expect(a).not.toBe(replayEtag(new Uint8Array([1, 2, 4])));
    expect(etagMatches(a, a)).toBe(true);
    expect(etagMatches(`W/${a}`, a)).toBe(true);
    expect(etagMatches(`"x", ${a}`, a)).toBe(true);
    expect(etagMatches("*", a)).toBe(true);
    expect(etagMatches('"otro"', a)).toBe(false);
    expect(etagMatches(undefined, a)).toBe(false);
  });
  it("ReplayCache: LRU acotada por bytes", () => {
    const c = new ReplayCache(10);
    const v = (n: number) => ({ body: Buffer.alloc(n), etag: "e", cacheControl: "c" });
    c.set("a", v(4));
    c.set("b", v(4));
    expect(c.get("a")).toBeDefined(); // a pasa a ser la más reciente
    c.set("c", v(4)); // expulsa b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.totalBytes).toBe(8);
    c.set("big", v(11)); // no cabe: se ignora
    expect(c.get("big")).toBeUndefined();
    expect(new ReplayCache(0).get("x")).toBeUndefined();
  });
});

describe("buildReplayWindow", () => {
  const params = { from: PAST, to: PAST + W, layers: ["bus", "bike", "weather"] as const };

  it("columnas por entidad, estado inicial, meta una vez y salida determinista", () => {
    const rows: ReplayRows = emptyReplayRows("raw");
    rows.positions.init = [pos("b2", PAST - 30_000, { lon: -8.5, heading: 10, speed: 3.14 })];
    rows.positions.rows = [
      pos("b2", PAST + 30_000, { lon: -8.50001, heading: 12, speed: 3.2, meta: { line: "2" } }),
      pos("b1", PAST + 15_000, { meta: { line: "1A" } }),
      pos("b1", PAST + 1000, { lon: -8.4 }),
      pos("b9", PAST + 2000, { layer: "ship" }), // otra capa: no entra en bus
    ];
    rows.stations.init = [
      { id: "s1", ts: PAST - 2 * MIN, lon: -8.41, lat: 43.37, bikes: 3, docks: 7 },
    ];
    rows.observations.rows = [
      {
        stationId: "m1",
        metric: "wind",
        layer: "weather",
        ts: PAST + 5000,
        value: 4.5,
        unit: "m/s",
      },
    ];
    const w = buildReplayWindow({ ...params, layers: [...params.layers] }, rows);
    expect(ReplayWindowSchema.safeParse(w).success).toBe(true);

    const bus = w.layers.bus;
    if (bus?.kind !== "mobile") throw new Error("kind");
    expect(bus.tracks.map((t) => t.id)).toEqual(["b1", "b2"]);
    const [b1, b2] = bus.tracks;
    expect(b1?.ts).toEqual([1000, 15_000]); // ordenado aunque lleguen desordenadas
    expect(b1?.meta).toEqual({ line: "1A" });
    expect(b1).not.toHaveProperty("init");
    expect(b1).not.toHaveProperty("heading"); // ninguna muestra con rumbo
    expect(b2?.init).toEqual({
      dt: -30_000,
      lon: -8.5 * REPLAY_COORD_SCALE,
      lat: Math.round(43.36 * REPLAY_COORD_SCALE),
      heading: 10,
      speed: 31,
    });
    expect(b2?.heading).toEqual([12]);
    expect(b2?.speed).toEqual([32]);
    expect(b2?.lon).toEqual([-850_001]);

    const bike = w.layers.bike;
    if (bike?.kind !== "station") throw new Error("kind");
    expect(bike.stations[0]).toMatchObject({
      id: "s1",
      init: { dt: -120_000, bikes: 3, docks: 7 },
      ts: [],
    });

    const weather = w.layers.weather;
    if (weather?.kind !== "series") throw new Error("kind");
    expect(weather.series).toEqual([
      { stationId: "m1", metric: "wind", unit: "m/s", ts: [5000], value: [4.5] },
    ]);

    // mismos datos, otro orden de entrada → mismos bytes (ETag estable)
    const shuffled: ReplayRows = {
      ...rows,
      positions: { ...rows.positions, rows: [...rows.positions.rows].reverse() },
    };
    const w2 = buildReplayWindow({ ...params, layers: [...params.layers] }, shuffled);
    expect(replayEtag(encode(w2))).toBe(replayEtag(encode(w)));
  });

  it("ts repetidos (gana el último) y valores negativos no rompen el contrato", () => {
    const rows = emptyReplayRows("raw");
    rows.positions.rows = [
      pos("b1", PAST + 1000, { lon: -8.1, speed: -2 }),
      pos("b1", PAST + 1000, { lon: -8.2, speed: -1 }),
    ];
    rows.stations.rows = [
      { id: "s", ts: PAST + 5, lon: -8, lat: 43, bikes: -1, docks: 2 },
      { id: "s", ts: PAST + 5, lon: -8, lat: 43, bikes: 3, docks: -4 },
    ];
    const w = buildReplayWindow({ ...params, layers: ["bus", "bike"] }, rows);
    expect(ReplayWindowSchema.safeParse(w).success).toBe(true);
    const bus = w.layers.bus;
    expect(bus?.kind === "mobile" && bus.tracks[0]?.lon).toEqual([-820_000]);
  });

  it("incluye todas las capas pedidas aunque estén vacías", () => {
    const w = buildReplayWindow({ ...params, layers: ["bus", "sea"] }, emptyReplayRows("1m"));
    expect(Object.keys(w.layers)).toEqual(["bus", "sea"]);
    expect(w.resolution).toBe("1m");
    expect(isEmptyWindow(w)).toBe(true);
    expect(ReplayWindowSchema.safeParse(w).success).toBe(true);
  });

  it("descarta filas fuera de [from, to)", () => {
    const rows = emptyReplayRows("raw");
    rows.positions.rows = [pos("b1", PAST - 1), pos("b1", PAST + W), pos("b1", PAST + W - 1)];
    const w = buildReplayWindow({ ...params, layers: ["bus"] }, rows);
    const bus = w.layers.bus;
    expect(bus?.kind === "mobile" && bus.tracks[0]?.ts).toEqual([W - 1]);
  });
});

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
  const port = (app.server.address() as AddressInfo).port;
  return { src, base: `http://127.0.0.1:${port}` };
}

const url = (base: string, from: number, to: number, layers?: string): string =>
  `${base}/api/v1/replay?from=${from}&to=${to}${layers === undefined ? "" : `&layers=${layers}`}`;

const body = async (r: Response): Promise<ReplayWindow> =>
  ReplayWindowSchema.parse(decode(new Uint8Array(await r.arrayBuffer())));

function seed(src: FakeSource): void {
  src.history.positions = [
    pos("bus:1", PAST - 2 * MIN, { lon: -8.4, heading: 90, speed: 5, meta: { line: "1A" } }),
    pos("bus:1", PAST + 10_000, { lon: -8.41 }),
    pos("bus:1", PAST + W + 1000, { lon: -8.42 }), // fuera de la ventana
    pos("bus:far", PAST - 30 * MIN), // más antiguo que el lookback (5 min): sin estado inicial
  ];
  src.history.stations = [
    { id: "st:1", ts: PAST - 10 * MIN, lon: -8.4, lat: 43.3, bikes: 2, docks: 8 },
    { id: "st:1", ts: PAST + 60_000, lon: -8.4, lat: 43.3, bikes: 4, docks: 6 },
  ];
  src.history.observations = [
    {
      stationId: "m1",
      metric: "wind_speed",
      layer: "weather",
      ts: PAST - MIN,
      value: 3,
      unit: "m/s",
    },
  ];
}

describe("GET /api/v1/replay", () => {
  it("devuelve MessagePack válido con estado inicial y datos de la ventana (round-trip)", async () => {
    const { src, base } = await start();
    seed(src);
    const r = await fetch(url(base, PAST, PAST + W, "weather,bike,bus"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/msgpack");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const w = await body(r);
    expect(w).toMatchObject({ v: 1, from: PAST, to: PAST + W, resolution: "raw" });
    expect(Object.keys(w.layers)).toEqual(["bus", "bike", "weather"]);

    const bus = w.layers.bus;
    if (bus?.kind !== "mobile") throw new Error("kind");
    expect(bus.tracks.map((t) => t.id)).toEqual(["bus:1"]); // bus:far no tiene estado inicial
    expect(bus.tracks[0]).toMatchObject({
      meta: { line: "1A" },
      init: { dt: -2 * MIN, lon: -840_000, heading: 90, speed: 50 },
      ts: [10_000],
      lon: [-841_000],
    });
    const bike = w.layers.bike;
    if (bike?.kind !== "station") throw new Error("kind");
    expect(bike.stations[0]).toMatchObject({
      init: { dt: -10 * MIN, bikes: 2, docks: 8 },
      ts: [60_000],
      bikes: [4],
    });
    const weather = w.layers.weather;
    if (weather?.kind !== "series") throw new Error("kind");
    expect(weather.series[0]).toMatchObject({ init: { dt: -MIN, value: 3 }, ts: [], value: [] });
  });

  it("solo consulta las capas pedidas y usa la resolución según la edad", async () => {
    const { src, base } = await start({ replayRawDays: 28 });
    await fetch(url(base, PAST, PAST + W, "bus"));
    expect(src.replayCalls[0]).toMatchObject({ layers: ["bus"], resolution: "raw", from: PAST });
    const old = Math.floor((NOW - 40 * DAY) / W) * W;
    const r = await fetch(url(base, old, old + W, "bus"));
    expect(r.status).toBe(200);
    expect(src.replayCalls[1]).toMatchObject({ resolution: "1m" });
    expect((await body(r)).resolution).toBe("1m");
  });

  it("400 para ventanas mayores de 5 min, capas inválidas y parámetros que faltan", async () => {
    const { base, src } = await start();
    const big = await fetch(url(base, PAST, PAST + W + 1));
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ error: "bad_request" });
    expect((await fetch(url(base, PAST, PAST + W, "bus,metro"))).status).toBe(400);
    expect((await fetch(`${base}/api/v1/replay?to=${PAST}`)).status).toBe(400);
    expect((await fetch(url(base, NOW - 400 * DAY, NOW - 400 * DAY + W))).status).toBe(400);
    expect(src.replayCalls).toHaveLength(0); // ni toca la BD
  });

  it("ventana pasada alineada: caché largo inmutable, ETag y 304", async () => {
    const { src, base } = await start();
    seed(src);
    const r1 = await fetch(url(base, PAST, PAST + W, "bus"));
    expect(r1.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    const etag = r1.headers.get("etag");
    expect(etag).toMatch(/^"[\w-]{22}"$/);
    await r1.arrayBuffer();
    const r2 = await fetch(url(base, PAST, PAST + W, "bus"), {
      headers: { "If-None-Match": etag ?? "" },
    });
    expect(r2.status).toBe(304);
    expect(r2.headers.get("etag")).toBe(etag);
    expect((await r2.arrayBuffer()).byteLength).toBe(0);
    // el orden de las capas no cambia la clave: segunda petición servida desde la caché
    await fetch(url(base, PAST, PAST + W, "bus"));
    expect(src.replayCalls).toHaveLength(1);
    // HEAD también responde
    expect((await fetch(url(base, PAST, PAST + W, "bus"), { method: "HEAD" })).status).toBe(200);
  });

  it("ventana que incluye ahora: TTL corto y sin caché de servidor", async () => {
    const { src, base } = await start();
    seed(src);
    const from = Math.floor(NOW / W) * W;
    const r = await fetch(url(base, from, from + W, "bus"));
    expect(r.headers.get("cache-control")).toBe("public, max-age=10");
    await r.arrayBuffer();
    await fetch(url(base, from, from + W, "bus"));
    expect(src.replayCalls).toHaveLength(2);
  });

  it("CORS como el resto de la API", async () => {
    const { base } = await start({ corsOrigins: ["https://pulso.example"] });
    const r = await fetch(url(base, PAST, PAST + W, "bus"), {
      headers: { Origin: "https://pulso.example" },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("https://pulso.example");
  });

  it("413 si se supera el tope de filas o de bytes", async () => {
    const a = await start();
    a.src.truncate = true;
    expect((await fetch(url(a.base, PAST, PAST + W, "bus"))).status).toBe(413);
    const b = await start({ replayMaxBytes: 1024 });
    b.src.history.positions = Array.from({ length: 200 }, (_, i) => pos(`b${i}`, PAST + 1000 + i));
    const r = await fetch(url(b.base, PAST, PAST + W, "bus"));
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ error: "too_large" });
  });

  it("503 si la BD no responde", async () => {
    const { src, base } = await start();
    src.failing = true;
    const r = await fetch(url(base, PAST, PAST + W, "bus"));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("5");
  });

  it("limita las peticiones simultáneas por IP (429) y une las idénticas", async () => {
    const { src, base } = await start({ replayMaxPerIp: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = src.replay.bind(src);
    src.replay = async (q: ReplayQuery) => {
      await gate;
      return real(q);
    };
    const first = fetch(url(base, PAST, PAST + W, "bus"));
    const twin = fetch(url(base, PAST, PAST + W, "bus")); // misma clave: comparte la consulta
    await new Promise((r) => setTimeout(r, 100));
    const other = await fetch(url(base, PAST - W, PAST, "bus")); // otra clave, mismo IP
    expect(other.status).toBe(429);
    expect(other.headers.get("retry-after")).toBe("2");
    release();
    expect((await first).status).toBe(200);
    expect((await twin).status).toBe(200);
    expect(src.replayCalls).toHaveLength(1);
    // liberado: ya se puede pedir otra
    expect((await fetch(url(base, PAST - W, PAST, "bus"))).status).toBe(200);
  });

  it("no cachea en memoria ventanas vacías ni no alineadas; errores sin caché", async () => {
    const { src, base } = await start();
    await (await fetch(url(base, PAST, PAST + W, "bus"))).arrayBuffer(); // vacía
    await (await fetch(url(base, PAST, PAST + W, "bus"))).arrayBuffer();
    expect(src.replayCalls).toHaveLength(2);
    seed(src);
    const un = PAST + 1000;
    await (await fetch(url(base, un, un + MIN, "bus"))).arrayBuffer();
    await (await fetch(url(base, un, un + MIN, "bus"))).arrayBuffer();
    expect(src.replayCalls).toHaveLength(4);
    const bad = await fetch(url(base, PAST, PAST + W + 1));
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });

  it("tope global de lecturas simultáneas (429)", async () => {
    const { src, base } = await start({ replayMaxPerIp: 5, replayMaxGlobal: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = src.replay.bind(src);
    src.replay = async (q: ReplayQuery) => {
      await gate;
      return real(q);
    };
    const first = fetch(url(base, PAST, PAST + W, "bus"));
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(url(base, PAST - W, PAST, "bus"))).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });
});
