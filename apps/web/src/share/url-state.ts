import type { LayerId } from "@pulso/schema";
import { recentDays } from "../time/day";
import type { ReplaySpeed } from "../replay/types";

/**
 * Estado compartible de la vista (M6.4) y su (de)serialización en el hash de la URL. Los valores
 * vienen de fuera (cualquiera puede escribir un enlace): se valida de forma estricta, se acota todo
 * y lo inválido se ignora sin lanzar nunca. Solo se leen números, instantes y palabras de una lista
 * cerrada; nada se interpreta como HTML ni se vuelve a escribir tal cual. Ver
 * `docs/specs/M6.4-url-compartible.md`.
 *
 * Formato (versión 1): `#v=1&c=lat,lon,zoom,rumbo,inclinación&l=bus,bike&m=r&t=2026-11-18T10:30Z&s=60`
 */
export const URL_VERSION = 1;
/** Un hash más largo se descarta entero (nuestros enlaces miden < 120 caracteres). */
export const MAX_HASH_LENGTH = 400;
/** Cuánto en el futuro se tolera `t` (reloj del visitante algo atrasado) antes de ignorarlo. */
export const FUTURE_TOLERANCE_MS = 300_000;
export const HISTORY_DAYS = 30;

/**
 * Copia local de `LAYER_IDS` de `@pulso/schema` (que arrastra zod al importar en tiempo de ejecución);
 * `url-state.test.ts` comprueba que coincide con el contrato.
 */
export const SHARE_LAYER_IDS: readonly LayerId[] = [
  "bus",
  "bike",
  "weather",
  "sea",
  "ship",
  "air",
  "plane",
  "train",
];

export const SHARE_SPEEDS: readonly ReplaySpeed[] = [1, 60, 600];

/** Límites de cámara: los del mapa (`map/map.ts`: bbox de las teselas, minZoom/maxZoom/maxPitch). */
export const CAMERA_LIMITS = {
  lon: [-8.58, -8.25],
  lat: [43.27, 43.52],
  zoom: [10.5, 17],
  pitch: [0, 70],
} as const;

export interface ShareCamera {
  lat: number;
  lon: number;
  zoom: number;
  /** Grados en (-180, 180]. */
  bearing: number;
  pitch: number;
}

export interface ShareState {
  camera?: ShareCamera;
  /** Capas visibles; ausente = todas. (Reservado: aún no hay selector de capas.) */
  layers?: LayerId[];
  /** `listen` (Escuchar, M7) está reservado como `m=e`. */
  mode: "view" | "replay";
  /** Instante reproducido, epoch ms UTC (solo en `replay`). */
  t?: number;
  speed?: ReplaySpeed;
  /** `p=1`: el enlace pide empezar reproduciendo. Nuestros enlaces nunca lo escriben. */
  play?: boolean;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, v));

/** Rumbo a (-180, 180]. */
function wrapBearing(b: number): number {
  const w = ((((b + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

const NUM = /^-?\d{1,3}(\.\d{1,8})?$/;

function parseCamera(raw: string): ShareCamera | undefined {
  const p = raw.split(",");
  if (p.length !== 5 || !p.every((x) => NUM.test(x))) return undefined;
  const [lat, lon, zoom, bearing, pitch] = p.map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    lat: clamp(lat, CAMERA_LIMITS.lat),
    lon: clamp(lon, CAMERA_LIMITS.lon),
    zoom: clamp(zoom, CAMERA_LIMITS.zoom),
    bearing: wrapBearing(bearing),
    pitch: clamp(pitch, CAMERA_LIMITS.pitch),
  };
}

function parseLayers(raw: string): LayerId[] | undefined {
  const out: LayerId[] = [];
  for (const id of raw.split(",", SHARE_LAYER_IDS.length * 2)) {
    const known = SHARE_LAYER_IDS.find((l) => l === id);
    if (known && !out.includes(known)) out.push(known);
  }
  return out.length > 0 ? out : undefined;
}

const ISO_MIN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?Z$/;

/** Instante UTC válido y dentro de los últimos 30 días (días de Madrid) hasta «ahora». */
function parseInstant(raw: string, now: number): number | undefined {
  const m = ISO_MIN.exec(raw);
  if (!m) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  // Fechas imposibles (31 de febrero…) que el motor «corrige» en silencio.
  if (new Date(ms).toISOString().slice(0, 16) !== (m[1] as string)) return undefined;
  const oldest = recentDays(now, HISTORY_DAYS).at(-1) as number;
  if (ms < oldest || ms > now + FUTURE_TOLERANCE_MS) return undefined;
  return Math.min(ms, now);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Parsea el hash (`location.hash`). Nunca lanza; sin enlace válido devuelve `{ mode: "view" }`. */
export function parseShareHash(hash: string, now: number): ShareState {
  const empty: ShareState = { mode: "view" };
  if (typeof hash !== "string" || hash.length < 2 || hash.length > MAX_HASH_LENGTH) return empty;
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, "").split("&", 16)) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq);
    const value = decode(part.slice(eq + 1));
    if (value !== null && !params.has(key)) params.set(key, value);
  }
  const version = params.get("v");
  if (version !== undefined && version !== String(URL_VERSION)) return empty;

  const state: ShareState = { mode: "view" };
  const c = params.get("c");
  const camera = c === undefined ? undefined : parseCamera(c);
  if (camera) state.camera = camera;
  const l = params.get("l");
  const layers = l === undefined ? undefined : parseLayers(l);
  if (layers) state.layers = layers;

  if (params.get("m") === "r") {
    state.mode = "replay";
    const tRaw = params.get("t");
    const t = tRaw === undefined ? undefined : parseInstant(tRaw, now);
    if (t !== undefined) state.t = t;
    const speed = SHARE_SPEEDS.find((s) => String(s) === params.get("s"));
    if (speed !== undefined) state.speed = speed;
    if (params.get("p") === "1") state.play = true;
  }
  return state;
}

/** `Number` redondeado sin ceros sobrantes (`14.20` → `14.2`, `-0` → `0`). */
const num = (v: number, decimals: number): string => String(Number(v.toFixed(decimals)));

/**
 * Serializa a hash (con `#`), o `""` si no hay nada que compartir. Los valores se acotan igual que
 * al leer, así que nunca se escribe algo que no se pudiera volver a leer.
 */
export function serializeShareState(state: ShareState): string {
  const out: string[] = [];
  const c = state.camera;
  if (c && [c.lat, c.lon, c.zoom, c.bearing, c.pitch].every(Number.isFinite)) {
    out.push(
      `c=${[
        num(clamp(c.lat, CAMERA_LIMITS.lat), 5),
        num(clamp(c.lon, CAMERA_LIMITS.lon), 5),
        num(clamp(c.zoom, CAMERA_LIMITS.zoom), 2),
        num(wrapBearing(c.bearing), 1),
        num(clamp(c.pitch, CAMERA_LIMITS.pitch), 1),
      ].join(",")}`,
    );
  }
  const layers = state.layers?.filter((l) => SHARE_LAYER_IDS.includes(l));
  if (layers && layers.length > 0) out.push(`l=${[...new Set(layers)].join(",")}`);
  if (state.mode === "replay") {
    out.push("m=r");
    if (state.t !== undefined && Number.isFinite(state.t)) {
      const minute = Math.floor(state.t / 60_000) * 60_000;
      out.push(`t=${new Date(minute).toISOString().slice(0, 16)}Z`);
    }
    if (state.speed !== undefined && SHARE_SPEEDS.includes(state.speed))
      out.push(`s=${state.speed}`);
    if (state.play) out.push("p=1");
  }
  return out.length > 0 ? `#v=${URL_VERSION}&${out.join("&")}` : "";
}

/** Enlace canónico: origen + ruta + hash. Sin `?lang=`, `?t=` ni otros parámetros de depuración. */
export function buildShareUrl(
  loc: Pick<Location, "origin" | "pathname">,
  state: ShareState,
): string {
  return `${loc.origin}${loc.pathname}${serializeShareState(state)}`;
}
