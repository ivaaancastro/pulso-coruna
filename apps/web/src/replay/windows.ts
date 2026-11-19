/**
 * Ventanas de 5 min alineadas (`from % 300000 == 0`), las únicas que la API cachea mucho tiempo
 * (docs/specs/M6.2-api-replay.md). Duplica `REPLAY_WINDOW_MS` de `@pulso/schema` para no arrastrar
 * zod al hilo principal; un test comprueba que coinciden.
 */
export const WINDOW_MS = 300_000;

/** Inicio de la ventana alineada que contiene `t`. */
export const windowStart = (t: number): number => Math.floor(t / WINDOW_MS) * WINDOW_MS;

/** Caché LRU en memoria de ventanas ya decodificadas, acotada por entradas y por bytes de red. */
export class WindowCache<T> {
  private readonly map = new Map<number, { value: T; bytes: number }>();
  private total = 0;

  constructor(
    private readonly maxEntries = 48,
    private readonly maxBytes = 24 * 1024 * 1024,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  /** Lee sin tocar el orden de uso. */
  peek(key: number): T | undefined {
    return this.map.get(key)?.value;
  }

  /** Lee y marca como usada. */
  get(key: number): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Guarda y expulsa lo menos usado hasta caber (la entrada nueva nunca se expulsa a sí misma). */
  set(key: number, value: T, bytes: number): void {
    const prev = this.map.get(key);
    if (prev) this.total -= prev.bytes;
    this.map.delete(key);
    this.map.set(key, { value, bytes });
    this.total += bytes;
    for (const k of this.map.keys()) {
      if (this.map.size <= 1) break;
      if (this.map.size <= this.maxEntries && this.total <= this.maxBytes) break;
      if (k === key) continue;
      const old = this.map.get(k);
      if (old) this.total -= old.bytes;
      this.map.delete(k);
    }
  }

  /** Expulsa las ventanas que `keep` rechaza (p. ej. las muy lejanas al instante actual). */
  retain(keep: (key: number) => boolean): void {
    for (const [k, v] of [...this.map]) {
      if (keep(k)) continue;
      this.total -= v.bytes;
      this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}
