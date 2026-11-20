/** Tope de voces simultáneas (CPU en móvil). */
export const MAX_VOICES = 16;

interface VoiceRecord {
  id: number;
  priority: number;
  startedAt: number;
  endsAt: number;
}

export interface Acquired {
  id: number;
  /** Voz que hay que cortar (robada) para dejar sitio; `null` si había hueco. */
  stolen: number | null;
}

/**
 * Reserva de voces. Cuenta lo planificado (aunque aún no haya empezado a sonar), así que el tope
 * es duro. Si está llena, roba la de menor prioridad y, a igual prioridad, la más antigua; si
 * todas tienen más prioridad que la petición, la descarta (`null`).
 */
export class VoicePool {
  private readonly voices = new Map<number, VoiceRecord>();
  private nextId = 1;

  constructor(readonly max = MAX_VOICES) {}

  get size(): number {
    return this.voices.size;
  }

  /** Libera las voces cuyo final ya pasó (por si `onended` se retrasa). */
  expire(now: number): number[] {
    const gone: number[] = [];
    for (const v of this.voices.values()) {
      if (v.endsAt <= now) gone.push(v.id);
    }
    for (const id of gone) this.voices.delete(id);
    return gone;
  }

  acquire(priority: number, startedAt: number, endsAt: number): Acquired | null {
    let stolen: number | null = null;
    if (this.voices.size >= this.max) {
      let victim: VoiceRecord | null = null;
      for (const v of this.voices.values()) {
        if (
          !victim ||
          v.priority < victim.priority ||
          (v.priority === victim.priority && v.startedAt < victim.startedAt)
        ) {
          victim = v;
        }
      }
      if (!victim || victim.priority > priority) return null;
      this.voices.delete(victim.id);
      stolen = victim.id;
    }
    const id = this.nextId++;
    this.voices.set(id, { id, priority, startedAt, endsAt });
    return { id, stolen };
  }

  release(id: number): void {
    this.voices.delete(id);
  }

  clear(): void {
    this.voices.clear();
  }
}
