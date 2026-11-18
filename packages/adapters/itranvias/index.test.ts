import { describe, expect, it, vi } from "vitest";
import { EntitySchema } from "@pulso/schema";
import {
  MAX_CONSECUTIVE_FAILURES,
  MIN_CYCLE_MS,
  createItranviasAdapter,
  itranviasConfigFromEnv,
  parseItranvias,
} from "./index.js";

import linea100 from "./fixtures/linea-100.json";
import sinServicio from "./fixtures/linea-sin-servicio.json";

const FIXTURES: Record<string, unknown> = {
  "linea-100.json": linea100,
  "linea-sin-servicio.json": sinServicio,
};
const fx = (n: string): unknown => structuredClone(FIXTURES[n]);
const T = 1_795_000_000_000;
const line = (lineId: string, body: unknown) => ({ lineId, receivedAt: T, body });
const wrap = (...lines: unknown[]) => ({ lines, errors: [] });

describe("parse", () => {
  it("caso normal: línea 1 con 3 buses", () => {
    const out = parseItranvias(wrap(line("100", fx("linea-100.json"))));
    expect(out).toHaveLength(3);
    out.forEach((e) => expect(EntitySchema.safeParse(e).success).toBe(true));
    const b = out.find((e) => e.id === "435");
    expect(b).toMatchObject({ layer: "bus", lon: -8.405, lat: 43.355055, ts: T });
    expect(b?.meta).toEqual({ source: "itranvias", lineId: "100", line: "1", direction: 1 });
  });

  it("línea sin buses (mapas:[[]])", () => {
    expect(parseItranvias(wrap(line("2451", fx("linea-sin-servicio.json"))))).toEqual([]);
  });

  it("campo ausente: sin bus/posx o sin sentido", () => {
    const body = {
      resultado: "OK",
      mapas: [
        {
          buses: [
            {
              sentido: "0",
              buses: [
                { posx: -8.4, posy: 43.36 },
                { bus: 1, posy: 43.36 },
              ],
            },
            { buses: [{ bus: 2, posx: -8.4, posy: 43.36 }] },
          ],
        },
      ],
    };
    const out = parseItranvias(wrap(line("100", body)));
    expect(out.map((e) => e.id)).toEqual(["2"]);
    expect(out[0]?.meta).not.toHaveProperty("direction");
  });

  it("coordenada inválida o fuera de A Coruña: se descarta", () => {
    const body = {
      resultado: "OK",
      mapas: [
        {
          buses: [
            {
              sentido: "0",
              buses: [
                { bus: 1, posx: 0, posy: 0 },
                { bus: 2, posx: "x", posy: 43.36 },
                { bus: 3, posx: -8.4, posy: 99 },
                { bus: 4, posx: -8.4, posy: 43.36 },
              ],
            },
          ],
        },
      ],
    };
    expect(parseItranvias(wrap(line("100", body))).map((e) => e.id)).toEqual(["4"]);
  });

  it("entrada basura, resultado != OK y bus duplicado entre líneas", () => {
    expect(parseItranvias(null)).toEqual([]);
    expect(parseItranvias(wrap(line("100", { resultado: "KO", mapas: [] })))).toEqual([]);
    const l = line("100", fx("linea-100.json"));
    expect(parseItranvias(wrap(l, { ...l, lineId: "1900" }))).toHaveLength(3);
  });
});

describe("fetch (sin red real)", () => {
  const sleep = vi.fn(async () => {});
  const ok = async () => fx("linea-100.json");

  it("desactivado por defecto: ninguna petición", async () => {
    const get = vi.fn(ok);
    const a = createItranviasAdapter({ get });
    expect(a.enabled).toBe(false);
    expect(await a.fetch(new AbortController().signal)).toEqual({ lines: [], errors: [] });
    expect(get).not.toHaveBeenCalled();
  });

  it("secuencial, con pausa entre peticiones y URL correcta", async () => {
    sleep.mockClear();
    let inflight = 0;
    let max = 0;
    const get = vi.fn(async () => {
      max = Math.max(max, ++inflight);
      await Promise.resolve();
      inflight--;
      return fx("linea-100.json");
    });
    const a = createItranviasAdapter({ enabled: true, get, sleep, lineIds: ["100", "200", "300"] });
    const raw = await a.fetch(new AbortController().signal);
    expect(max).toBe(1);
    expect(get).toHaveBeenCalledTimes(3);
    expect((get.mock.calls as unknown[][])[0]?.[0]).toContain("dato=100&mostrar=B&func=99");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(a.parse(raw)).toHaveLength(3);
  });

  it("intervalMs nunca baja de 15 s y no hay ciclos más rápidos", async () => {
    let t = T;
    const get = vi.fn(ok);
    const a = createItranviasAdapter({
      enabled: true,
      intervalMs: 1000,
      get,
      sleep,
      now: () => t,
      lineIds: ["100"],
    });
    expect(a.intervalMs).toBe(MIN_CYCLE_MS);
    const s = new AbortController().signal;
    await a.fetch(s);
    t += 5000;
    expect(((await a.fetch(s)) as { lines: unknown[] }).lines).toHaveLength(0);
    t += MIN_CYCLE_MS;
    expect(((await a.fetch(s)) as { lines: unknown[] }).lines).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("corta el ciclo tras fallos seguidos", async () => {
    const get = vi.fn(async () => {
      throw new Error("HTTP 503");
    });
    const a = createItranviasAdapter({ enabled: true, get, sleep });
    const raw = (await a.fetch(new AbortController().signal)) as { errors: unknown[] };
    expect(get).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
    expect(raw.errors).toHaveLength(MAX_CONSECUTIVE_FAILURES);
  });

  it("propaga la cancelación", async () => {
    const ac = new AbortController();
    const get = vi.fn(async () => {
      ac.abort(new Error("cancelado"));
      throw ac.signal.reason;
    });
    const a = createItranviasAdapter({ enabled: true, get, sleep });
    await expect(a.fetch(ac.signal)).rejects.toThrow("cancelado");
  });
});

describe("config de entorno", () => {
  it("solo ITRANVIAS_ENABLED=true activa", () => {
    expect(itranviasConfigFromEnv({}).enabled).toBe(false);
    expect(itranviasConfigFromEnv({ ITRANVIAS_ENABLED: "1" }).enabled).toBe(false);
    expect(
      itranviasConfigFromEnv({ ITRANVIAS_ENABLED: "true", ITRANVIAS_MIN_INTERVAL_MS: "20000" }),
    ).toEqual({ enabled: true, intervalMs: 20000 });
  });
});
