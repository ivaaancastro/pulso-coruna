// Lógica pura del service worker (sin APIs de worker): enrutado, versionado de caché y Range.

export const CACHE_PREFIX = "pulso-";
/** Teselas: caché propia, independiente de la versión del shell. Cambiar el sufijo para renovarlas. */
export const TILES_CACHE = `${CACHE_PREFIX}tiles-v2`;
export const TILES_PATH = "/tiles/coruna.pmtiles";

export type Strategy =
  | "bypass" // red directa, sin tocar caché
  | "navigation" // shell precacheado, con red como respaldo
  | "tiles" // PMTiles con soporte Range
  | "immutable" // ficheros con hash: caché primero
  | "stale-while-revalidate";

export interface RouteInput {
  method: string;
  url: string;
  mode?: string;
  /** Origen del service worker. */
  origin: string;
}

const API_ROOTS = ["/api", "/ws"];

export function shellCacheName(version: string): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

/** Cachés propias que ya no valen: otras versiones del shell o prefijos propios desconocidos. */
export function staleCaches(existing: readonly string[], version: string): string[] {
  const keep = new Set([shellCacheName(version), TILES_CACHE]);
  return existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name));
}

export function routeRequest(input: RouteInput): Strategy {
  if (input.method !== "GET") return "bypass";
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return "bypass";
  }
  if (url.origin !== input.origin) return "bypass"; // el navegador solo habla con nuestro origen
  if (url.protocol === "ws:" || url.protocol === "wss:") return "bypass";
  const path = url.pathname;
  if (API_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    return "bypass"; // API y WebSocket: nunca en caché
  }
  if (path === TILES_PATH) return "tiles";
  if (input.mode === "navigate") return "navigation";
  if (path.startsWith("/assets/")) return "immutable";
  return "stale-while-revalidate";
}

export interface ByteRange {
  start: number;
  /** Inclusivo. */
  end: number;
}

export type RangeParse =
  { kind: "none" } | { kind: "range"; range: ByteRange } | { kind: "unsatisfiable" };

/** Parsea `Range: bytes=a-b | a- | -n` (un solo rango) contra el tamaño total. */
export function parseRange(header: string | null, size: number): RangeParse {
  if (!header) return { kind: "none" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "none" }; // multirrango o sintaxis ajena: se sirve entero (200)
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return { kind: "none" };
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return { kind: "unsatisfiable" };
  return { kind: "range", range: { start, end } };
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** ¿Hay que lanzar la descarga completa en segundo plano? Solo sin caché y sin otra en curso. */
export function shouldPrefetchTiles(cached: boolean, inFlight: boolean): boolean {
  return !cached && !inFlight;
}
