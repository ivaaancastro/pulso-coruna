import type { Clock } from "../src/types.js";

interface Timer {
  at: number;
  resolve: () => void;
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Reloj controlado a mano: el tiempo solo avanza con `advance`. */
export class FakeClock implements Clock {
  private t = 0;
  private timers: Timer[] = [];

  /** Temporizadores pendientes (útil para esperar a que un bucle vuelva a dormir). */
  get pending(): number {
    return this.timers.length;
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const timer: Timer = { at: this.t + ms, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((x) => x !== timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** Avanza `ms` disparando los temporizadores en orden y dejando correr las promesas entre medias. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await flush();
    for (;;) {
      const next = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.resolve();
      await flush();
    }
    this.t = target;
    await flush();
  }
}
