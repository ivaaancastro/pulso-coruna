/** Cuenta conexiones simultáneas por IP. Puro, sin temporizadores. */
export class ConnectionLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** `true` y cuenta la conexión si hay hueco; `false` si la IP ya está en su límite. */
  acquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  /** Comprueba sin reservar (rechazo temprano, antes del handshake). */
  isFull(ip: string): boolean {
    return (this.counts.get(ip) ?? 0) >= this.max;
  }

  release(ip: string): void {
    const n = this.counts.get(ip) ?? 0;
    if (n <= 1) this.counts.delete(ip);
    else this.counts.set(ip, n - 1);
  }

  count(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }
}
