import { createHash } from "node:crypto";
import {
  LAYER_IDS,
  REPLAY_VERSION,
  REPLAY_WINDOW_MS,
  replayKindForLayer,
  toReplayCoord,
  toReplaySpeed,
  type LayerId,
  type ReplayLayer,
  type ReplayResolution,
  type ReplaySeries,
  type ReplayStation,
  type ReplayTrack,
  type ReplayWindow,
} from "@pulso/schema";
import { parseLayers } from "./protocol.js";
import type { ObservationSample, PositionSample, ReplayRows, StationSample } from "./replay-db.js";

const DAY_MS = 86_400_000;

/** Un bloque pasado tarda en «asentarse»: la ingesta y el agregado de 1 min (M6.1) van con retraso. */
export const REPLAY_SETTLE_MS = 10 * 60_000;

export interface ReplayParams {
  from: number;
  to: number;
  /** En orden canónico (`LAYER_IDS`), sin duplicados: la misma ventana tiene siempre la misma clave. */
  layers: LayerId[];
}

export type ParsedReplay = { ok: true; params: ReplayParams } | { ok: false; error: string };

export const parseMs = (raw: unknown, name: string): number | string => {
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw))
    return `${name} es obligatorio y debe ser epoch ms UTC (entero)`;
  const n = Number(raw);
  if (n <= 1e11) return `${name} debe ser epoch en milisegundos (no en segundos)`;
  return n;
};

/** Valida `?from=&to=&layers=`. Sin `layers` = todas. `from` ≤ ahora, ventana (0, 5 min], no más antigua que `maxAgeDays`. */
export function parseReplayParams(
  query: Record<string, unknown>,
  now: number,
  maxAgeDays: number,
): ParsedReplay {
  const from = parseMs(query["from"], "from");
  if (typeof from === "string") return { ok: false, error: from };
  const to = parseMs(query["to"], "to");
  if (typeof to === "string") return { ok: false, error: to };
  if (to <= from) return { ok: false, error: "to debe ser mayor que from" };
  if (to - from > REPLAY_WINDOW_MS)
    return { ok: false, error: `la ventana máxima es de ${REPLAY_WINDOW_MS / 60_000} min` };
  if (from > now) return { ok: false, error: "from está en el futuro" };
  if (from < now - maxAgeDays * DAY_MS)
    return { ok: false, error: `from es anterior a los ${maxAgeDays} días de histórico` };
  const layers = parseLayers(query["layers"]);
  if (!layers.ok) return { ok: false, error: layers.error };
  const wanted = new Set(layers.layers);
  return { ok: true, params: { from, to, layers: LAYER_IDS.filter((l) => wanted.has(l)) } };
}

/** Corte brutos/1 min (M6.1): `ahora − rawDays`, redondeado al minuto como hace la retención. */
export const replayCutoff = (now: number, rawDays: number): number =>
  Math.floor((now - rawDays * DAY_MS) / 60_000) * 60_000;

/**
 * `raw` si toda la ventana es posterior al corte; `1m` si empieza antes (aunque su final sea ya bruto:
 * una ventana que cruza el corte mezcla cadencias y se anuncia con la más gruesa).
 */
export const replayResolution = (from: number, cutoff: number): ReplayResolution =>
  from >= cutoff ? "raw" : "1m";

/** `from` múltiplo de 5 min y ventana de exactamente 5 min: la URL que la web precarga y la CDN cachea. */
export const isAlignedWindow = (from: number, to: number): boolean =>
  from % REPLAY_WINDOW_MS === 0 && to - from === REPLAY_WINDOW_MS;

/**
 * Política de caché por ventana:
 * - incluye «ahora» → TTL de segundos (aún crece);
 * - pasada pero reciente (< `REPLAY_SETTLE_MS`) o vacía → 1 min;
 * - pasada, asentada y alineada → un día (`raw`: se recomprimirá a 1 min pasados 30 días) o un año (`1m`);
 * - pasada, asentada, no alineada → 1 h.
 */
export function replayCacheControl(o: {
  from: number;
  to: number;
  now: number;
  resolution: ReplayResolution;
  empty: boolean;
}): string {
  if (o.to > o.now) return "public, max-age=10";
  if (o.empty || o.to > o.now - REPLAY_SETTLE_MS) return "public, max-age=60";
  if (!isAlignedWindow(o.from, o.to)) return "public, max-age=3600";
  return o.resolution === "1m"
    ? "public, max-age=31536000, immutable"
    : "public, max-age=86400, immutable";
}

/** ETag fuerte: hash del cuerpo (mismos datos = mismos bytes, porque la salida está ordenada). */
export const replayEtag = (body: Uint8Array): string =>
  `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;

/** `If-None-Match` puede traer varias etiquetas, `*` o la forma débil `W/"…"`. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

// ---------------------------------------------------------------------------------------------
// Filas → mensaje columnar
// ---------------------------------------------------------------------------------------------

const byKey = <T>(m: Map<string, T[]>, key: string): T[] => {
  let a = m.get(key);
  if (!a) m.set(key, (a = []));
  return a;
};
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const hdg = (h: number): number => Math.min(360, Math.max(0, Math.round(h)));
/** Ordena por `ts` y, con `ts` repetido, se queda con la última muestra (el esquema exige ts estrictos). */
const sortedUnique = <T extends { ts: number }>(a: T[], from: number, to: number): T[] => {
  const m = new Map<number, T>();
  for (const r of a) if (r.ts >= from && r.ts < to) m.set(r.ts, r);
  return [...m.values()].sort((x, y) => x.ts - y.ts);
};
const nn = (n: number): number => Math.max(0, n);
const initDt = (ts: number, from: number): number => Math.min(0, ts - from);

/** Última meta no vacía (la más reciente de la ventana, o la del estado inicial). */
const lastMeta = (...samples: (PositionSample | undefined)[]): ReplayTrack["meta"] | undefined => {
  for (const s of samples) if (s?.meta && Object.keys(s.meta).length > 0) return s.meta;
  return undefined;
};

function buildTracks(layer: LayerId, from: number, to: number, rows: ReplayRows): ReplayTrack[] {
  const init = new Map(rows.positions.init.filter((r) => r.layer === layer).map((r) => [r.id, r]));
  const samples = new Map<string, PositionSample[]>();
  for (const r of rows.positions.rows) if (r.layer === layer) byKey(samples, r.id).push(r);
  const ids = [...new Set([...init.keys(), ...samples.keys()])].sort(cmp);
  return ids.map((id): ReplayTrack => {
    const s = sortedUnique(samples.get(id) ?? [], from, to);
    const i = init.get(id);
    const meta = lastMeta(s[s.length - 1], i);
    const hasHeading = s.some((r) => r.heading !== null);
    const hasSpeed = s.some((r) => r.speed !== null);
    return {
      id,
      ...(meta && { meta: { ...meta } }),
      ...(i && {
        init: {
          dt: initDt(i.ts, from),
          lon: toReplayCoord(i.lon),
          lat: toReplayCoord(i.lat),
          ...(i.heading !== null && { heading: hdg(i.heading) }),
          ...(i.speed !== null && { speed: nn(toReplaySpeed(i.speed)) }),
        },
      }),
      ts: s.map((r) => r.ts - from),
      lon: s.map((r) => toReplayCoord(r.lon)),
      lat: s.map((r) => toReplayCoord(r.lat)),
      ...(hasHeading && { heading: s.map((r) => (r.heading === null ? null : hdg(r.heading))) }),
      ...(hasSpeed && {
        speed: s.map((r) => (r.speed === null ? null : nn(toReplaySpeed(r.speed)))),
      }),
    };
  });
}

function buildStations(from: number, to: number, rows: ReplayRows): ReplayStation[] {
  const init = new Map(rows.stations.init.map((r) => [r.id, r]));
  const samples = new Map<string, StationSample[]>();
  for (const r of rows.stations.rows) byKey(samples, r.id).push(r);
  const ids = [...new Set([...init.keys(), ...samples.keys()])].sort(cmp);
  return ids.map((id): ReplayStation => {
    const s = sortedUnique(samples.get(id) ?? [], from, to);
    const i = init.get(id);
    const pos = s[s.length - 1] ?? i;
    return {
      id,
      lon: toReplayCoord(pos?.lon ?? 0),
      lat: toReplayCoord(pos?.lat ?? 0),
      ...(i && { init: { dt: initDt(i.ts, from), bikes: nn(i.bikes), docks: nn(i.docks) } }),
      ts: s.map((r) => r.ts - from),
      bikes: s.map((r) => nn(r.bikes)),
      docks: s.map((r) => nn(r.docks)),
    };
  });
}

function buildSeries(layer: LayerId, from: number, to: number, rows: ReplayRows): ReplaySeries[] {
  const key = (r: { stationId: string; metric: string }): string =>
    `${r.stationId}\u0000${r.metric}`;
  const init = new Map(
    rows.observations.init.filter((r) => r.layer === layer).map((r) => [key(r), r]),
  );
  const samples = new Map<string, ObservationSample[]>();
  for (const r of rows.observations.rows) if (r.layer === layer) byKey(samples, key(r)).push(r);
  const keys = [...new Set([...init.keys(), ...samples.keys()])].sort(cmp);
  return keys.map((k): ReplaySeries => {
    const s = sortedUnique(samples.get(k) ?? [], from, to);
    const i = init.get(k);
    const ref = s[s.length - 1] ?? i;
    return {
      stationId: ref?.stationId ?? "",
      metric: ref?.metric ?? "",
      unit: ref?.unit ?? "",
      ...(i && { init: { dt: initDt(i.ts, from), value: i.value } }),
      ts: s.map((r) => r.ts - from),
      value: s.map((r) => r.value),
    };
  });
}

/** Une las filas de la BD en el mensaje `ReplayWindow` v1: una entrada por cada capa pedida, aunque vacía. */
export function buildReplayWindow(p: ReplayParams, rows: ReplayRows): ReplayWindow {
  const layers: ReplayWindow["layers"] = {};
  for (const layer of p.layers) {
    const kind = replayKindForLayer(layer);
    const payload: ReplayLayer =
      kind === "mobile"
        ? { kind, tracks: buildTracks(layer, p.from, p.to, rows) }
        : kind === "station"
          ? { kind, stations: buildStations(p.from, p.to, rows) }
          : { kind, series: buildSeries(layer, p.from, p.to, rows) };
    layers[layer] = payload;
  }
  return { v: REPLAY_VERSION, from: p.from, to: p.to, resolution: rows.resolution, layers };
}

/** ¿No hay ni una muestra ni un estado inicial en ninguna capa? */
export const isEmptyWindow = (w: ReplayWindow): boolean =>
  Object.values(w.layers).every((l) =>
    l.kind === "mobile"
      ? l.tracks.length === 0
      : l.kind === "station"
        ? l.stations.length === 0
        : l.series.length === 0,
  );

// ---------------------------------------------------------------------------------------------
// Caché en memoria de ventanas ya codificadas
// ---------------------------------------------------------------------------------------------

export interface EncodedReplay {
  body: Buffer;
  etag: string;
  cacheControl: string;
}

/** LRU acotada por bytes. Solo se guardan ventanas asentadas: el resto cambia. */
export class ReplayCache {
  private readonly map = new Map<string, EncodedReplay>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): EncodedReplay | undefined {
    const v = this.map.get(key);
    if (!v) return undefined;
    this.map.delete(key);
    this.map.set(key, v); // más reciente
    return v;
  }

  set(key: string, value: EncodedReplay): void {
    if (this.maxBytes <= 0 || value.body.length > this.maxBytes) return;
    const prev = this.map.get(key);
    if (prev) {
      this.bytes -= prev.body.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.body.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= v.body.length;
    }
  }

  get size(): number {
    return this.map.size;
  }
  get totalBytes(): number {
    return this.bytes;
  }
}
