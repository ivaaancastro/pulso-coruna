import type { Entity } from "@pulso/schema";

/** Rumbo normalizado a [0, 360). */
export function normalizeHeading(deg: number): number {
  const h = deg % 360;
  return h < 0 ? h + 360 : h;
}

/** Interpola rumbos por el arco más corto (359 → 1 pasa por 0, no por 180). */
export function lerpHeading(from: number, to: number, u: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return normalizeHeading(from + delta * u);
}

const M_PER_DEG_LAT = 111_320;

/** Rumbo de A a B (aproximación plana, válida a escala urbana) y distancia en metros. */
export function bearingAndDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): { bearing: number; meters: number } {
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)) * M_PER_DEG_LAT;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return {
    bearing: normalizeHeading((Math.atan2(dx, dy) * 180) / Math.PI),
    meters: Math.hypot(dx, dy),
  };
}

export interface InterpolatorOptions {
  /** Duración mínima de un tramo, ms. Evita saltos bruscos con ts casi iguales. */
  minDurationMs?: number;
  /** Duración máxima de un tramo y mayor hueco que aún se interpola; más allá, salto. */
  maxDurationMs?: number;
  /** Sin movimiento continuo: cada dato se muestra tal cual (prefers-reduced-motion). */
  reducedMotion?: boolean;
}

interface Track {
  fromLon: number;
  fromLat: number;
  fromHeading: number;
  toLon: number;
  toLat: number;
  toHeading: number;
  /** Instante (reloj de la app) en que arrancó el tramo. */
  t0: number;
  duration: number;
  /** `ts` de la fuente del último dato. */
  ts: number;
}

export interface Pose {
  lon: number;
  lat: number;
  heading: number;
}

export interface InterpolatedBuffers {
  count: number;
  ids: string[];
  idsVersion: number;
  positions: Float32Array;
  headings: Float32Array;
}

/**
 * Interpolación de entidades móviles de una capa. Cada dato nuevo arranca un tramo desde la pose
 * mostrada en ese instante (continuidad, sin teletransportes) hasta la posición recibida, en el
 * intervalo de muestreo de la fuente. Al terminar el tramo la entidad se queda quieta: no se
 * extrapola.
 */
export class Interpolator {
  private readonly tracks = new Map<string, Track>();
  private readonly minDuration: number;
  private readonly maxDuration: number;
  private reducedMotion: boolean;
  private idsCache: string[] | null = [];
  private version = 0;
  private dirty = true;
  private busyUntil = 0;
  private lastFill = Number.NEGATIVE_INFINITY;

  constructor(options: InterpolatorOptions = {}) {
    this.minDuration = options.minDurationMs ?? 500;
    this.maxDuration = options.maxDurationMs ?? 30_000;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  get size(): number {
    return this.tracks.size;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      // Congela cada entidad en su destino.
      for (const t of this.tracks.values()) {
        t.fromLon = t.toLon;
        t.fromLat = t.toLat;
        t.fromHeading = t.toHeading;
        t.duration = 0;
      }
      this.busyUntil = 0;
    }
    this.dirty = true;
  }

  /** Incorpora un dato. Devuelve `false` si se descartó por viejo o repetido. */
  upsert(entity: Entity, now: number): boolean {
    const prev = this.tracks.get(entity.id);
    if (!prev) {
      const heading = normalizeHeading(entity.heading ?? 0);
      this.tracks.set(entity.id, {
        fromLon: entity.lon,
        fromLat: entity.lat,
        fromHeading: heading,
        toLon: entity.lon,
        toLat: entity.lat,
        toHeading: heading,
        t0: now,
        duration: 0,
        ts: entity.ts,
      });
      this.idsCache = null;
      this.version++;
      this.dirty = true;
      return true;
    }
    if (entity.ts <= prev.ts) return false;

    const current = this.poseOf(prev, now);
    const gap = entity.ts - prev.ts;
    const moved = bearingAndDistance(current.lon, current.lat, entity.lon, entity.lat);
    // Sin rumbo en el dato: el de la marcha si se movió de verdad; si no, el último.
    const heading =
      entity.heading !== undefined
        ? normalizeHeading(entity.heading)
        : moved.meters > 2
          ? moved.bearing
          : current.heading;

    prev.fromLon = current.lon;
    prev.fromLat = current.lat;
    prev.fromHeading = current.heading;
    prev.toLon = entity.lon;
    prev.toLat = entity.lat;
    prev.toHeading = heading;
    prev.t0 = now;
    prev.ts = entity.ts;
    // Hueco enorme (el móvil estuvo sin datos): salto limpio mejor que deslizarlo por la ciudad.
    prev.duration =
      this.reducedMotion || gap > this.maxDuration ? 0 : Math.max(this.minDuration, gap);
    this.busyUntil = Math.max(this.busyUntil, now + prev.duration);
    this.dirty = true;
    return true;
  }

  remove(id: string): boolean {
    if (!this.tracks.delete(id)) return false;
    this.idsCache = null;
    this.version++;
    this.dirty = true;
    return true;
  }

  /** Elimina las entidades cuyo id no esté en `keep` (tras un snapshot). */
  retainOnly(keep: ReadonlySet<string>): void {
    for (const id of [...this.tracks.keys()]) if (!keep.has(id)) this.remove(id);
  }

  /** Pose en el instante `now`, o `undefined` si la entidad no existe. */
  sample(id: string, now: number): Pose | undefined {
    const track = this.tracks.get(id);
    return track ? this.poseOf(track, now) : undefined;
  }

  /** ¿Hay algo que redibujar? En movimiento continuo, mientras algún tramo siga vivo. */
  needsFrame(): boolean {
    // `lastFill < busyUntil`: tras el fin del último tramo aún falta entregar el fotograma final.
    return this.dirty || (!this.reducedMotion && this.lastFill < this.busyUntil);
  }

  /** Rellena buffers nuevos (transferibles) con la pose de todas las entidades en `now`. */
  fill(now: number): InterpolatedBuffers {
    const count = this.tracks.size;
    const positions = new Float32Array(count * 2);
    const headings = new Float32Array(count);
    const rebuild = this.idsCache === null;
    const ids: string[] = this.idsCache ?? [];
    this.idsCache = ids;
    let i = 0;
    const pose = { lon: 0, lat: 0, heading: 0 };
    for (const [id, track] of this.tracks) {
      this.poseInto(track, now, pose);
      positions[i * 2] = pose.lon;
      positions[i * 2 + 1] = pose.lat;
      headings[i] = pose.heading;
      if (rebuild) ids.push(id);
      i++;
    }
    this.dirty = false;
    this.lastFill = now;
    return { count, ids, idsVersion: this.version, positions, headings };
  }

  private poseOf(track: Track, now: number): Pose {
    const pose = { lon: 0, lat: 0, heading: 0 };
    return this.poseInto(track, now, pose);
  }

  private poseInto(track: Track, now: number, out: Pose): Pose {
    const u = track.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - track.t0) / track.duration));
    out.lon = track.fromLon + (track.toLon - track.fromLon) * u;
    out.lat = track.fromLat + (track.toLat - track.fromLat) * u;
    out.heading = lerpHeading(track.fromHeading, track.toHeading, u);
    return out;
  }
}
