import type { ReplaySpeed } from "./types";

export type ClockEvent = "play" | "pause" | "seek" | "speed" | "stall" | "bounds" | "end";

export interface ReplayClockOptions {
  /** Reloj monotónico, ms (`performance.now`). */
  perf: () => number;
  /**
   * Mayor intervalo real que se integra de una vez, ms. Si la pestaña estuvo oculta o el hilo
   * bloqueado, el reloj no salta horas a 600×: simplemente continúa donde estaba.
   */
  maxStepMs?: number;
  speed?: ReplaySpeed;
}

/**
 * Reloj de reproducción: instante (epoch ms UTC) que avanza `speed` veces más rápido que el real
 * mientras está en marcha y no detenido por falta de datos. Se integra de forma perezosa en
 * cada lectura, así que cualquiera puede llamar a `read()` varias veces por fotograma.
 * Acotado a `[min, max]`: al llegar al final se pausa y avisa (`end`).
 */
export class ReplayClock {
  private pos = 0;
  private lo = 0;
  private hi = Number.POSITIVE_INFINITY;
  private _speed: ReplaySpeed;
  private _playing = false;
  private _stalled = false;
  private last: number;
  private readonly maxStep: number;
  private readonly listeners = new Set<(event: ClockEvent) => void>();

  constructor(private readonly opts: ReplayClockOptions) {
    this._speed = opts.speed ?? 60;
    this.maxStep = opts.maxStepMs ?? 250;
    this.last = opts.perf();
  }

  get speed(): ReplaySpeed {
    return this._speed;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** Detenido a la espera de datos (la reproducción sigue «en marcha» pero no avanza). */
  get stalled(): boolean {
    return this._stalled;
  }

  get min(): number {
    return this.lo;
  }

  get max(): number {
    return this.hi;
  }

  /** Instante actual de la reproducción. */
  read(): number {
    const perf = this.opts.perf();
    const dt = Math.min(Math.max(0, perf - this.last), this.maxStep);
    this.last = perf;
    if (this._playing && !this._stalled && dt > 0) {
      this.pos += dt * this._speed;
      if (this.pos >= this.hi) {
        this.pos = this.hi;
        this._playing = false;
        this.emit("end");
      }
    }
    return this.pos;
  }

  /** Fija los límites del día (y lo que llega hasta «ahora»), y encaja el instante dentro. */
  setBounds(min: number, max: number): void {
    this.read();
    this.lo = min;
    this.hi = Math.max(min, max);
    const clamped = this.clamp(this.pos);
    if (clamped !== this.pos) this.pos = clamped;
    this.emit("bounds");
  }

  seek(t: number): void {
    this.read();
    this.pos = this.clamp(t);
    this.emit("seek");
  }

  play(): void {
    this.read();
    if (this._playing) return;
    // Pulsar «reproducir» al final del día no hace nada útil: vuelve al principio del día.
    if (this.pos >= this.hi && this.hi > this.lo) this.pos = this.lo;
    this._playing = true;
    this.emit("play");
  }

  pause(): void {
    this.read();
    if (!this._playing) return;
    this._playing = false;
    this.emit("pause");
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  setSpeed(speed: ReplaySpeed): void {
    this.read();
    if (speed === this._speed) return;
    this._speed = speed;
    this.emit("speed");
  }

  setStalled(stalled: boolean): void {
    if (stalled === this._stalled) return;
    this.read();
    this._stalled = stalled;
    this.emit("stall");
  }

  subscribe(listener: (event: ClockEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private clamp(t: number): number {
    return Math.min(this.hi, Math.max(this.lo, t));
  }

  private emit(event: ClockEvent): void {
    for (const l of [...this.listeners]) l(event);
  }
}
