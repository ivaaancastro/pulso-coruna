import type { LayerId, ReplayWindow } from "@pulso/schema";
import type { ReplayErrorKind } from "./types";
import { WINDOW_MS } from "./windows";

/** Capas que la web sabe dibujar (no se pide `train`: no hay capa). Orden canónico de `LAYER_IDS`. */
export const REPLAY_LAYERS: readonly LayerId[] = [
  "bus",
  "bike",
  "weather",
  "sea",
  "ship",
  "air",
  "plane",
];

export type LoadResult =
  | { ok: true; window: ReplayWindow; bytes: number }
  | { ok: false; reason: ReplayErrorKind | "aborted" };

export interface LoaderDeps {
  /** `…/api/v1/replay` (nuestra API; el navegador no llama a ninguna otra fuente). */
  baseUrl: string;
  fetch: (url: string, init: { signal: AbortSignal; credentials: "omit" }) => Promise<ResponseLike>;
  /** MessagePack → valor (se inyecta para cargar `@msgpack/msgpack` solo cuando hace falta). */
  decode: (bytes: Uint8Array) => unknown;
  /** `ReplayWindowSchema.safeParse`: `null` si no cumple el contrato. */
  validate: (value: unknown) => ReplayWindow | null;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  layers?: readonly LayerId[];
  /** Reintentos ante 429/503 con `Retry-After` (por defecto 2: tres intentos). */
  retries?: number;
}

/** Subconjunto de `Response` que usamos. */
export interface ResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

const RETRY_DEFAULT_MS: Record<number, number> = { 429: 2000, 503: 5000 };
const RETRY_MAX_MS = 10_000;

/** `empty`: la API contestó 400 (fuera de rango): no hay datos para esa ventana. */
type Req = LoadResult | { ok: true; empty: true };

export const emptyWindow = (from: number): ReplayWindow => ({
  v: 1,
  from,
  to: from + WINDOW_MS,
  resolution: "raw",
  layers: {},
});

/** `Retry-After` en segundos (el servidor solo envía enteros) → ms acotados; `fallback` si no se entiende. */
export function retryAfterMs(header: string | null, fallback: number): number {
  const secs = header === null ? Number.NaN : Number(header);
  if (!Number.isFinite(secs) || secs < 0) return fallback;
  return Math.min(RETRY_MAX_MS, Math.max(250, secs * 1000));
}

const isAbort = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";

/**
 * Cliente HTTP de ventanas: pide `from`..`from+5 min` (alineado), decodifica y valida.
 * - 200: MessagePack → `ReplayWindowSchema`; si no valida, `invalid` (no se reintenta).
 * - 429/503: espera `Retry-After` (acotado) y reintenta; si se agotan, `rate`/`server`.
 * - 413: la ventana pesa demasiado → se pide capa a capa y se funden.
 * - 400: fuera del rango que sirve la API (demasiado antigua): ventana vacía, no es un error.
 * - Resto (5xx, red): `server`/`network`; quien llama decide cuándo volver a intentarlo.
 */
export function createWindowLoader(deps: LoaderDeps): {
  load(from: number, signal: AbortSignal): Promise<LoadResult>;
} {
  const layers = deps.layers ?? REPLAY_LAYERS;
  const retries = deps.retries ?? 2;

  const urlFor = (from: number, only: readonly LayerId[]): string =>
    `${deps.baseUrl}?from=${from}&to=${from + WINDOW_MS}&layers=${only.join(",")}`;

  async function request(
    from: number,
    only: readonly LayerId[],
    signal: AbortSignal,
  ): Promise<Req> {
    for (let attempt = 0; ; attempt++) {
      let res: ResponseLike;
      try {
        res = await deps.fetch(urlFor(from, only), { signal, credentials: "omit" });
      } catch (error) {
        return { ok: false, reason: isAbort(error) || signal.aborted ? "aborted" : "network" };
      }
      if (res.status === 200) {
        try {
          const buf = await res.arrayBuffer();
          const window = deps.validate(await deps.decode(new Uint8Array(buf)));
          if (!window || window.from !== from) return { ok: false, reason: "invalid" };
          return { ok: true, window, bytes: buf.byteLength };
        } catch (error) {
          return { ok: false, reason: isAbort(error) || signal.aborted ? "aborted" : "invalid" };
        }
      }
      if (res.status === 400) return { ok: true, empty: true };
      if (res.status === 413) return { ok: false, reason: "too_large" };
      if (res.status === 429 || res.status === 503) {
        if (attempt >= retries)
          return { ok: false, reason: res.status === 429 ? "rate" : "server" };
        const wait = retryAfterMs(
          res.headers.get("Retry-After"),
          RETRY_DEFAULT_MS[res.status] ?? 2000,
        );
        try {
          await deps.sleep(wait, signal);
        } catch {
          return { ok: false, reason: "aborted" };
        }
        if (signal.aborted) return { ok: false, reason: "aborted" };
        continue;
      }
      return { ok: false, reason: "server" };
    }
  }

  return {
    async load(from, signal) {
      const first = await request(from, layers, signal);
      if (first.ok && "empty" in first) return { ok: true, window: emptyWindow(from), bytes: 0 };
      if (first.ok || first.reason !== "too_large") return first;
      // 413: demasiadas filas con todas las capas juntas. Una petición por capa y se funden.
      const parts: ReplayWindow[] = [];
      let bytes = 0;
      for (const layer of layers) {
        const part = await request(from, [layer], signal);
        if (part.ok && "empty" in part) continue;
        if (!part.ok) return part;
        bytes += part.bytes;
        parts.push(part.window);
      }
      const [first0, ...rest] = parts;
      const merged = first0
        ? rest.reduce<ReplayWindow>(
            (acc, w) => ({
              ...acc,
              resolution: w.resolution === "1m" ? "1m" : acc.resolution,
              layers: { ...acc.layers, ...w.layers },
            }),
            first0,
          )
        : emptyWindow(from);
      return { ok: true, window: merged, bytes };
    },
  };
}
