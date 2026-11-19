import { COVERAGE, M_LAT, inCoverage, type FieldValue, type WindField } from "./field";

/**
 * Sistema de partículas de viento en CPU (lon/lat) que produce segmentos listos para un `LineLayer`
 * binario. Sin DOM ni WebGL: se prueba en Node. Todo búfer se reserva una vez.
 */

/** Cámara rápida: 1 m/s de viento recorre `TIMELAPSE` m/s de terreno (proporcional al viento). */
export const TIMELAPSE = 60;
/** Cada cuánto se guarda una muestra de la estela, s. */
export const SAMPLE_INTERVAL = 0.07;
export const LIFE_MIN = 2;
export const LIFE_MAX = 6;
const FADE_IN = 0.6;
const FADE_OUT = 1;
/** Por debajo de esta velocidad (m/s) la partícula se desvanece: calma, no hay flujo que mostrar. */
const CALM_MS = 0.5;
/** Por debajo de esta confianza el punto no se usa para nacer (se reintenta unas veces). */
const MIN_SPAWN_CONFIDENCE = 0.05;
export const MIN_QUALITY = 0.1;
export const DEFAULT_MAX_PARTICLES = 1500;
export const DEFAULT_TRAIL_POINTS = 10;

export interface SegmentBuffers {
  /** lon, lat intercalados. */
  source: Float32Array;
  target: Float32Array;
  /** RGBA, 4 bytes por segmento. */
  color: Uint8Array;
}

export function allocateSegmentBuffers(maxSegments: number): SegmentBuffers {
  return {
    source: new Float32Array(maxSegments * 2),
    target: new Float32Array(maxSegments * 2),
    color: new Uint8Array(maxSegments * 4),
  };
}

export const clampQuality = (q: number): number =>
  Number.isFinite(q) ? Math.min(1, Math.max(MIN_QUALITY, q)) : 1;

/** Generador pseudoaleatorio determinista (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export interface ParticleOptions {
  maxParticles?: number;
  /** Puntos por estela (cabeza incluida); segmentos = puntos − 1. */
  trailPoints?: number;
  rng?: () => number;
  quality?: number;
}

export class ParticleSystem {
  readonly maxParticles: number;
  readonly maxTrailPoints: number;
  private readonly rng: () => number;
  private readonly hist: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  /** Confianza × calma de cada partícula (opacidad base, antes del fundido de vida). */
  private readonly vis: Float32Array;
  private readonly alive: Uint8Array;
  private readonly scratch: FieldValue = { u: 0, v: 0, confidence: 0 };
  private q: number;
  private sampleClock = 0;

  constructor(opts: ParticleOptions = {}) {
    this.maxParticles = Math.max(1, Math.floor(opts.maxParticles ?? DEFAULT_MAX_PARTICLES));
    this.maxTrailPoints = Math.max(2, Math.floor(opts.trailPoints ?? DEFAULT_TRAIL_POINTS));
    this.rng = opts.rng ?? Math.random;
    this.q = clampQuality(opts.quality ?? 1);
    this.hist = new Float32Array(this.maxParticles * this.maxTrailPoints * 2);
    this.age = new Float32Array(this.maxParticles);
    this.life = new Float32Array(this.maxParticles);
    this.vis = new Float32Array(this.maxParticles);
    this.alive = new Uint8Array(this.maxParticles);
  }

  get quality(): number {
    return this.q;
  }

  setQuality(q: number): void {
    this.q = clampQuality(q);
    // Las que quedan fuera dejan de existir: al subir la calidad renacen en vez de reaparecer viejas.
    for (let i = this.activeCount; i < this.maxParticles; i++) this.alive[i] = 0;
  }

  /** Partículas que se mueven y se dibujan con la calidad actual. */
  get activeCount(): number {
    return Math.max(1, Math.round(this.maxParticles * this.q));
  }

  /** Puntos de estela con la calidad actual (la estela se acorta al bajar la calidad). */
  get trailPoints(): number {
    return Math.min(
      this.maxTrailPoints,
      Math.max(3, Math.round(this.maxTrailPoints * (0.4 + 0.6 * this.q))),
    );
  }

  get maxSegments(): number {
    return this.maxParticles * (this.maxTrailPoints - 1);
  }

  /** Todas las partículas renacen (p. ej. al volver los datos tras un hueco). */
  reset(): void {
    this.alive.fill(0);
    this.sampleClock = 0;
  }

  /** Posición actual (cabeza) de la partícula `i`: solo para pruebas y diagnóstico. */
  head(i: number, out: [number, number] = [0, 0]): [number, number] {
    const b = i * this.maxTrailPoints * 2;
    out[0] = this.hist[b] as number;
    out[1] = this.hist[b + 1] as number;
    return out;
  }

  private spawn(i: number, field: WindField, staggered: boolean): void {
    const T = this.maxTrailPoints;
    let lon = 0;
    let lat = 0;
    for (let tries = 0; tries < 4; tries++) {
      lon = COVERAGE.west + this.rng() * (COVERAGE.east - COVERAGE.west);
      lat = COVERAGE.south + this.rng() * (COVERAGE.north - COVERAGE.south);
      if (field.sample(lon, lat, this.scratch).confidence >= MIN_SPAWN_CONFIDENCE) break;
    }
    const base = i * T * 2;
    for (let k = 0; k < T; k++) {
      this.hist[base + k * 2] = lon;
      this.hist[base + k * 2 + 1] = lat;
    }
    const life = LIFE_MIN + this.rng() * (LIFE_MAX - LIFE_MIN);
    this.life[i] = life;
    this.age[i] = staggered ? this.rng() * life : 0;
    this.vis[i] = 0;
    this.alive[i] = 1;
  }

  /** Avanza `dt` segundos. Sin campo (vacío) no hace nada. */
  step(dt: number, field: WindField): void {
    if (field.empty || !(dt > 0)) return;
    const n = this.activeCount;
    const T = this.maxTrailPoints;
    const sc = this.scratch;
    this.sampleClock += dt;
    const shift = this.sampleClock >= SAMPLE_INTERVAL;
    if (shift) this.sampleClock %= SAMPLE_INTERVAL;
    for (let i = 0; i < n; i++) {
      const base = i * T * 2;
      if (!this.alive[i]) {
        this.spawn(i, field, true);
        continue;
      }
      const age = (this.age[i] as number) + dt;
      this.age[i] = age;
      let x = this.hist[base] as number;
      let y = this.hist[base + 1] as number;
      if (age >= (this.life[i] as number) || !inCoverage(x, y)) {
        this.spawn(i, field, false);
        continue;
      }
      field.sample(x, y, sc);
      const speed = Math.hypot(sc.u, sc.v);
      this.vis[i] = sc.confidence * smooth(speed / CALM_MS);
      const k = TIMELAPSE * dt;
      x += (sc.u * k) / (Math.cos((y * Math.PI) / 180) * M_LAT);
      y += (sc.v * k) / M_LAT;
      if (shift) this.hist.copyWithin(base + 2, base, base + (T - 1) * 2);
      this.hist[base] = x;
      this.hist[base + 1] = y;
    }
  }

  /**
   * Escribe los segmentos visibles y devuelve cuántos. Color `rgb` (0–255) y opacidad máxima
   * `alpha` (0–1); la estela se desvanece hacia la cola y la partícula, al nacer y al morir.
   */
  fill(out: SegmentBuffers, rgb: readonly [number, number, number], alpha: number): number {
    const n = this.activeCount;
    const T = this.maxTrailPoints;
    const points = this.trailPoints;
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const age = this.age[i] as number;
      const fade = smooth(Math.min(age / FADE_IN, ((this.life[i] as number) - age) / FADE_OUT));
      const head = alpha * (this.vis[i] as number) * fade;
      if (head < 0.02) continue;
      const base = i * T * 2;
      for (let k = 0; k < points - 1; k++) {
        const a = head * (1 - k / (points - 1)) ** 1.5;
        const o = s * 2;
        const p = base + k * 2;
        out.source[o] = this.hist[p] as number;
        out.source[o + 1] = this.hist[p + 1] as number;
        out.target[o] = this.hist[p + 2] as number;
        out.target[o + 1] = this.hist[p + 3] as number;
        const c = s * 4;
        out.color[c] = rgb[0];
        out.color[c + 1] = rgb[1];
        out.color[c + 2] = rgb[2];
        out.color[c + 3] = Math.round(a * 255);
        s++;
      }
    }
    return s;
  }
}
