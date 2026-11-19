import { describe, expect, it, vi } from "vitest";
import { EntitySchema, type Entity } from "@pulso/schema";
import {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  RateLimitError,
  createOpenskyAdapter,
  openskyConfigFromEnv,
  parseOpensky,
  statesUrl,
} from "./index.js";

import galicia from "./fixtures/galicia-3-aeronaves.json";
import vacio from "./fixtures/vacio.json";

const T = 1_795_002_030_000;
const wrap = (body: unknown) => ({ fetchedAt: T, body });
const fx = (b: unknown): Record<string, unknown> => structuredClone(b) as Record<string, unknown>;

describe("parse", () => {
  it("caso normal: 3 aeronaves, segundos a ms", () => {
    const out = parseOpensky(wrap(galicia));
    expect(out).toHaveLength(3);
    out.forEach((e) => expect(EntitySchema.safeParse(e).success).toBe(true));
    const e = out.find((x) => x.id === "344195");
    expect(e).toMatchObject({
      layer: "plane",
      lon: -8.425,
      lat: 42.9254,
      heading: 165.63,
      speed: 64.26,
      ts: 1_795_001_945_000,
    });
    expect(e?.meta).toEqual({
      source: "opensky",
      callsign: "ANE68DM",
      alt: 525.78,
      onGround: 0,
      vrate: -3.9,
    });
  });

  it("vacío: states null => []", () => {
    expect(parseOpensky(wrap(vacio))).toEqual([]);
  });

  it("campos nulos: sin lon/lat se descarta; sin track/velocidad/callsign se omiten", () => {
    const body = fx(galicia);
    const rows = body.states as unknown[][];
    rows[0] = [
      "aaaaaa",
      "",
      "X",
      null,
      1795002000,
      -8.4,
      43.3,
      null,
      true,
      null,
      null,
      null,
      null,
      null,
    ];
    (rows[1] as unknown[])[5] = null;
    const out = parseOpensky(wrap(body));
    expect(out.map((e) => e.id)).toEqual(["aaaaaa", "344695"]);
    const a = out[0] as Entity;
    expect(a.ts).toBe(1_795_002_000_000); // last_contact como respaldo
    expect(a).not.toHaveProperty("heading");
    expect(a).not.toHaveProperty("speed");
    expect(a.meta).toEqual({ source: "opensky", onGround: 1 });
  });

  it("formato inválido lanza", () => {
    expect(() => parseOpensky(wrap({ states: "x" }))).toThrow();
    expect(() => parseOpensky(null)).toThrow();
  });
});

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("fetch", () => {
  const signal = new AbortController().signal;

  it("deshabilitado: no toca la red", async () => {
    const fetchFn = vi.fn();
    const a = createOpenskyAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(a.parse(await a.fetch(signal))).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("usa el bbox y avisa al acercarse a la cuota", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      res(200, galicia, { "x-rate-limit-remaining": "12" }),
    );
    const warn = vi.fn();
    const a = createOpenskyAdapter({
      enabled: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      warn,
      now: () => T,
    });
    const raw = (await a.fetch(signal)) as { creditsRemaining?: number };
    expect(fetchFn.mock.calls[0]?.[0]).toBe(statesUrl());
    expect(statesUrl()).toContain("lamin=43.25&lomin=-8.65&lamax=43.5&lomax=-8.2");
    expect(raw.creditsRemaining).toBe(12);
    expect(warn).toHaveBeenCalledOnce();
    expect(a.parse(raw)).toHaveLength(3);
  });

  it("429: error tipado con Retry-After y enfriamiento sin tocar la red", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      res(429, {}, { "x-rate-limit-retry-after-seconds": "7200" }),
    );
    let t = T;
    const a = createOpenskyAdapter({
      enabled: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => t,
    });
    const err = await a.fetch(signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(7_200_000);
    t += 60_000;
    const err2 = await a.fetch(signal).catch((e: unknown) => e);
    expect((err2 as RateLimitError).retryAfterMs).toBe(7_140_000);
    expect(fetchFn).toHaveBeenCalledOnce();
    t += 7_200_000;
    fetchFn.mockImplementationOnce(async () => res(200, vacio));
    await expect(a.fetch(signal)).resolves.toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("otros errores HTTP lanzan", async () => {
    const a = createOpenskyAdapter({
      enabled: true,
      fetchFn: (async () => res(500, {})) as unknown as typeof fetch,
    });
    await expect(a.fetch(signal)).rejects.toThrow(/HTTP 500/);
  });

  it("OAuth2 opcional: pide token y lo envía como Bearer", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.includes("openid-connect")
        ? res(200, { access_token: "tok", expires_in: 1800 })
        : res(200, vacio);
    });
    const a = createOpenskyAdapter({
      enabled: true,
      clientId: "id",
      clientSecret: "s",
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => T,
    });
    await a.fetch(signal);
    await a.fetch(signal);
    expect(calls.filter((c) => c.url.includes("openid-connect"))).toHaveLength(1);
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });
});

describe("config", () => {
  it("intervalo por defecto 5 min y suelo 60 s", () => {
    expect(createOpenskyAdapter().intervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(createOpenskyAdapter({ intervalMs: 1000 }).intervalMs).toBe(MIN_INTERVAL_MS);
  });
  it("env: solo 'true' activa; credenciales solo si hay ambas", () => {
    expect(openskyConfigFromEnv({}).enabled).toBe(false);
    expect(
      openskyConfigFromEnv({ OPENSKY_ENABLED: "true", OPENSKY_INTERVAL_MS: "120000" }),
    ).toEqual({ enabled: true, intervalMs: 120000 });
    expect(openskyConfigFromEnv({ OPENSKY_CLIENT_ID: "a" })).not.toHaveProperty("clientId");
  });
});
