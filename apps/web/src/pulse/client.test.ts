import { describe, expect, it, vi } from "vitest";
import { PulseFetchError, fetchPulse, pulseRequestUrl, type FetchLike } from "./client";
import { PULSE_STEP_MS, pulseWindow } from "./model";

const NOW = Date.parse("2026-11-19T12:03:27Z");
const W = pulseWindow(NOW);

const body = (over: Record<string, unknown> = {}) => ({
  v: 1,
  from: W.from,
  to: W.to,
  stepMs: PULSE_STEP_MS,
  profile: "fixed",
  points: [
    { ts: W.to - 2 * PULSE_STEP_MS, value: 48.2, layers: { bus: 1.1 } },
    { ts: W.to - PULSE_STEP_MS, value: 51, layers: {} },
  ],
  ...over,
});

const ok =
  (json: unknown): FetchLike =>
  async () => ({ ok: true, status: 200, json: async () => json });

describe("cliente de /api/v1/pulse", () => {
  it("pide from, to y step a la URL de nuestra API", async () => {
    const spy = vi.fn(ok(body()));
    await fetchPulse("http://localhost:3000/api/v1/pulse", W, spy);
    const url = new URL(spy.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/pulse");
    expect(url.searchParams.get("from")).toBe(String(W.from));
    expect(url.searchParams.get("to")).toBe(String(W.to));
    expect(url.searchParams.get("step")).toBe("300000");
    expect(pulseRequestUrl("/p?x=1", W)).toBe(`/p?x=1&from=${W.from}&to=${W.to}&step=300000`);
  });

  it("valida con PulseSchema y devuelve los datos", async () => {
    const d = await fetchPulse("/api/v1/pulse", W, ok(body()));
    expect(d.profile).toBe("fixed");
    expect(d.points).toHaveLength(2);
    expect(d.points[1]?.value).toBe(51);
  });

  it.each([
    [
      "valor fuera de rango",
      body({ points: [{ ts: W.to - PULSE_STEP_MS, value: 140, layers: {} }] }),
    ],
    ["versión desconocida", body({ v: 2 })],
    ["clave desconocida", body({ extra: 1 })],
    ["ts desalineado", body({ points: [{ ts: W.to - PULSE_STEP_MS + 1, value: 5, layers: {} }] })],
    ["no es un objeto", "hola"],
  ])("respuesta fuera de contrato (%s) → error", async (_n, json) => {
    await expect(fetchPulse("/p", W, ok(json))).rejects.toMatchObject({
      name: "PulseFetchError",
      kind: "error",
    });
  });

  it("400 → nodata; 5xx/429 → error", async () => {
    const status =
      (s: number): FetchLike =>
      async () => ({ ok: false, status: s, json: async () => ({}) });
    await expect(fetchPulse("/p", W, status(400))).rejects.toMatchObject({ kind: "nodata" });
    await expect(fetchPulse("/p", W, status(503))).rejects.toMatchObject({ kind: "error" });
    await expect(fetchPulse("/p", W, status(429))).rejects.toMatchObject({ kind: "error" });
  });

  it("fallo de red o JSON roto → error; el aborto se propaga tal cual", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("network");
    };
    await expect(fetchPulse("/p", W, down)).rejects.toBeInstanceOf(PulseFetchError);
    const broken: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("json");
      },
    });
    await expect(fetchPulse("/p", W, broken)).rejects.toMatchObject({ kind: "error" });
    const ctl = new AbortController();
    ctl.abort();
    const aborted: FetchLike = async () => {
      throw new DOMException("abort", "AbortError");
    };
    await expect(fetchPulse("/p", W, aborted, ctl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
