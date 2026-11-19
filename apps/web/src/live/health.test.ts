import { describe, expect, it } from "vitest";
import { parseHealth, resolveHealthUrl } from "./health";

describe("resolveHealthUrl", () => {
  it("deriva /health de la URL del stream de nuestra API", () => {
    expect(resolveHealthUrl("ws://localhost:5173/api/v1/stream")).toBe(
      "http://localhost:5173/api/v1/health",
    );
    expect(resolveHealthUrl("wss://pulso.example/api/v1/stream?layers=bus")).toBe(
      "https://pulso.example/api/v1/health",
    );
  });

  it("devuelve null si no es un stream ws(s) reconocible", () => {
    expect(resolveHealthUrl("https://x/api/v1/stream")).toBeNull();
    expect(resolveHealthUrl("ws://x/otra/cosa")).toBeNull();
    expect(resolveHealthUrl("no es una url")).toBeNull();
  });
});

describe("parseHealth", () => {
  it("extrae lastDataAt por capa e ignora lo desconocido o mal formado", () => {
    const body = {
      layers: {
        bus: { lastDataAt: 1000, ageMs: 5 },
        bike: { lastDataAt: null, ageMs: null },
        weather: { lastDataAt: "no" },
        sea: { lastDataAt: -3 },
        marciano: { lastDataAt: 5 },
      },
    };
    expect(parseHealth(body)).toEqual({ bus: 1000, bike: null });
  });

  it("devuelve null ante basura", () => {
    expect(parseHealth(null)).toBeNull();
    expect(parseHealth("x")).toBeNull();
    expect(parseHealth({})).toBeNull();
    expect(parseHealth({ layers: 3 })).toBeNull();
  });
});
