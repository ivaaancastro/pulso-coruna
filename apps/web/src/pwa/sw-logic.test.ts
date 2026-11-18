import { describe, expect, it } from "vitest";
import {
  TILES_CACHE,
  contentRange,
  parseRange,
  routeRequest,
  shellCacheName,
  shouldPrefetchTiles,
  staleCaches,
} from "./sw-logic";

const origin = "https://pulso.test";
const route = (path: string, extra: { method?: string; mode?: string } = {}) =>
  routeRequest({ method: "GET", origin, url: `${origin}${path}`, ...extra });

describe("routeRequest", () => {
  it("nunca cachea la API ni el WebSocket", () => {
    expect(route("/api/v1/entities")).toBe("bypass");
    expect(route("/api/")).toBe("bypass");
    expect(route("/ws")).toBe("bypass");
    expect(route("/ws/live")).toBe("bypass");
    expect(routeRequest({ method: "GET", origin, url: "wss://pulso.test/ws" })).toBe("bypass");
  });

  it("no toca métodos no GET ni otros orígenes", () => {
    expect(route("/", { method: "POST" })).toBe("bypass");
    expect(routeRequest({ method: "GET", origin, url: "https://otro.test/x.js" })).toBe("bypass");
    expect(routeRequest({ method: "GET", origin, url: "no es una url" })).toBe("bypass");
  });

  it("enruta teselas, navegación, hashes y estáticos", () => {
    expect(route("/tiles/coruna.pmtiles")).toBe("tiles");
    expect(route("/tiles/coruna.pmtiles?x=1")).toBe("tiles");
    expect(route("/", { mode: "navigate" })).toBe("navigation");
    expect(route("/assets/index-abc123.js")).toBe("immutable");
    expect(route("/fonts/archivo-latin-wdth-normal.woff2")).toBe("stale-while-revalidate");
    expect(route("/manifest.webmanifest")).toBe("stale-while-revalidate");
  });

  it("una navegación a la API sigue siendo bypass", () => {
    expect(route("/api/v1/x", { mode: "navigate" })).toBe("bypass");
  });
});

describe("versionado de caché", () => {
  it("nombra el shell por versión", () => {
    expect(shellCacheName("abc")).toBe("pulso-shell-abc");
  });

  it("borra cachés propias antiguas y conserva shell actual, teselas y ajenas", () => {
    const existing = [
      "pulso-shell-old",
      "pulso-shell-new",
      TILES_CACHE,
      "pulso-tiles-v0",
      "otra-app",
    ];
    expect(staleCaches(existing, "new")).toEqual(["pulso-shell-old", "pulso-tiles-v0"]);
  });
});

describe("parseRange", () => {
  it("sin cabecera o ajena: sirve entero", () => {
    expect(parseRange(null, 100)).toEqual({ kind: "none" });
    expect(parseRange("items=0-1", 100)).toEqual({ kind: "none" });
    expect(parseRange("bytes=0-1,5-6", 100)).toEqual({ kind: "none" });
    expect(parseRange("bytes=-", 100)).toEqual({ kind: "none" });
  });

  it("rango cerrado, abierto y de sufijo", () => {
    expect(parseRange("bytes=0-15", 100)).toEqual({ kind: "range", range: { start: 0, end: 15 } });
    expect(parseRange("bytes=90-", 100)).toEqual({ kind: "range", range: { start: 90, end: 99 } });
    expect(parseRange("bytes=-10", 100)).toEqual({ kind: "range", range: { start: 90, end: 99 } });
    expect(parseRange("bytes=-500", 100)).toEqual({ kind: "range", range: { start: 0, end: 99 } });
  });

  it("recorta el final al tamaño", () => {
    expect(parseRange("bytes=50-999", 100)).toEqual({
      kind: "range",
      range: { start: 50, end: 99 },
    });
  });

  it("insatisfacible", () => {
    expect(parseRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=20-10", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("tesela", () => {
  it("formatea Content-Range", () => {
    expect(contentRange({ start: 0, end: 15 }, 100)).toBe("bytes 0-15/100");
  });

  it("solo descarga completa sin caché y sin otra en curso", () => {
    expect(shouldPrefetchTiles(false, false)).toBe(true);
    expect(shouldPrefetchTiles(true, false)).toBe(false);
    expect(shouldPrefetchTiles(false, true)).toBe(false);
  });
});
