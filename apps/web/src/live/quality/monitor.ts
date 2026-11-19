/**
 * Monitor de fps con histéresis (M4.7). Puro: no usa `requestAnimationFrame` ni reloj propio; se le
 * pasa cada fotograma con su marca de tiempo. Devuelve el nivel de calidad vigente.
 *
 * - Degrada un nivel si los fps (medidos en ventanas de 1 s) están por debajo de `lowFps` durante
 *   `lowMs` seguidos; un pico corto no cuenta (la cuenta se reinicia en cuanto un segundo va bien).
 * - Recupera un nivel con fps ≥ `highFps` durante `recoverMs` seguidos y al menos `minGapMs` desde
 *   el último cambio. Si recuperar vuelve a degradar, la espera se duplica (máx. ×8): no oscila.
 * - No cuenta el arranque (`warmupMs` desde el primer fotograma), ni la pestaña oculta
 *   (`setActive(false)`), ni huecos de más de `gapMs` entre fotogramas (pestaña en segundo plano).
 */
export type QualityLevel = "high" | "medium" | "low";
export const QUALITY_LEVELS: readonly QualityLevel[] = ["high", "medium", "low"];

export interface MonitorOptions {
  lowFps?: number;
  lowMs?: number;
  highFps?: number;
  recoverMs?: number;
  minGapMs?: number;
  warmupMs?: number;
  gapMs?: number;
  initial?: QualityLevel;
}

const WINDOW_MS = 1000;
const MAX_BACKOFF = 8;

export class FpsMonitor {
  private readonly o: Required<MonitorOptions>;
  private index: number;
  private active = true;
  private startedAt: number | null = null;
  private last: number | null = null;
  private times: number[] = [];
  private lowSince: number | null = null;
  private highSince: number | null = null;
  private lastChange = Number.NEGATIVE_INFINITY;
  private lastWasRecovery = false;
  private backoff = 1;
  private currentFps = 0;

  constructor(options: MonitorOptions = {}) {
    this.o = {
      lowFps: 45,
      lowMs: 3000,
      highFps: 55,
      recoverMs: 10_000,
      minGapMs: 10_000,
      warmupMs: 5000,
      gapMs: 1000,
      initial: "high",
      ...options,
    };
    this.index = QUALITY_LEVELS.indexOf(this.o.initial);
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.index] as QualityLevel;
  }

  /** Últimos fps medidos (ventana de 1 s); 0 si aún no hay datos. */
  get fps(): number {
    return this.currentFps;
  }

  /** Fuerza un nivel (p. ej. `?perf=` en dev) sin pasar por la histéresis. */
  force(level: QualityLevel): void {
    this.index = QUALITY_LEVELS.indexOf(level);
    this.resetWindow();
  }

  /**
   * Pestaña oculta o reduced-motion: no se mide. Al reactivar se descarta el hueco y la ventana
   * (el calentamiento no se repite).
   */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.resetWindow();
    this.last = null;
  }

  /** Registra un fotograma en `t` (ms). Devuelve el nuevo nivel si cambió, o `null`. */
  frame(t: number): QualityLevel | null {
    if (!this.active) return null;
    const prev = this.last;
    this.last = t;
    if (this.startedAt === null) this.startedAt = t;
    // Hueco largo: segundo plano o parón del hilo, no una tasa de fotogramas medible.
    if (prev === null || t - prev > this.o.gapMs) {
      this.resetWindow();
      return null;
    }
    this.times.push(t);
    while (this.times.length > 1 && (this.times[0] as number) < t - WINDOW_MS) this.times.shift();
    const n = this.times.length;
    const span = t - (this.times[0] as number);
    this.currentFps = n > 1 && span > 0 ? ((n - 1) * 1000) / span : 1000 / Math.max(1, t - prev);
    if (t - this.startedAt < this.o.warmupMs) return null;

    if (this.currentFps < this.o.lowFps) {
      this.highSince = null;
      this.lowSince ??= t;
      if (t - this.lowSince >= this.o.lowMs && this.index < QUALITY_LEVELS.length - 1) {
        if (this.lastWasRecovery) this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
        return this.change(t, 1, false);
      }
    } else if (this.currentFps >= this.o.highFps) {
      this.lowSince = null;
      this.highSince ??= t;
      if (
        this.index > 0 &&
        t - this.highSince >= this.o.recoverMs * this.backoff &&
        t - this.lastChange >= this.o.minGapMs * this.backoff
      ) {
        return this.change(t, -1, true);
      }
    } else {
      this.lowSince = null;
      this.highSince = null;
    }
    return null;
  }

  private change(t: number, delta: 1 | -1, recovery: boolean): QualityLevel {
    this.index += delta;
    this.lastChange = t;
    this.lastWasRecovery = recovery;
    this.resetWindow();
    return this.level;
  }

  private resetWindow(): void {
    this.times = [];
    this.lowSince = null;
    this.highSince = null;
  }
}
