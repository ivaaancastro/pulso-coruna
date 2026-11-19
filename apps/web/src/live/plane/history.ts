import type { PlaneInfo } from "./meta";

/**
 * Posiciones recibidas de cada avión (no inventa pasado): la traza se dibuja con lo que el cliente
 * ya conoce. Un fix por `ts` distinto.
 */
export const MAX_FIXES = 6;
/** Fixes más viejos que esto se olvidan. */
export const MAX_FIX_AGE_MS = 30 * 60_000;
/** Si entre dos fixes pasó más que esto, el avión salió de la caja y volvió: no se unen. */
export const MAX_FIX_GAP_MS = 12 * 60_000;

export interface Fix {
  ts: number;
  lon: number;
  lat: number;
}

export class FixHistory {
  private readonly fixes = new Map<string, Fix[]>();

  get size(): number {
    return this.fixes.size;
  }

  clear(): void {
    this.fixes.clear();
  }

  /** Anota los aviones actuales; olvida los que ya no están y los fixes viejos. */
  record(planes: readonly PlaneInfo[], now: number): void {
    const present = new Set<string>();
    for (const p of planes) {
      present.add(p.id);
      let list = this.fixes.get(p.id);
      if (!list) {
        list = [];
        this.fixes.set(p.id, list);
      }
      const last = list[list.length - 1];
      if (last && p.ts <= last.ts) continue;
      if (last && p.ts - last.ts > MAX_FIX_GAP_MS) list.length = 0;
      list.push({ ts: p.ts, lon: p.lon, lat: p.lat });
      if (list.length > MAX_FIXES) list.splice(0, list.length - MAX_FIXES);
    }
    for (const [id, list] of this.fixes) {
      if (!present.has(id)) {
        this.fixes.delete(id);
        continue;
      }
      while (list.length > 1 && now - (list[0] as Fix).ts > MAX_FIX_AGE_MS) list.shift();
    }
  }

  get(id: string): readonly Fix[] {
    return this.fixes.get(id) ?? [];
  }
}

export interface TrailSegment {
  path: [[number, number], [number, number]];
  /** 0–1, ya con el desvanecimiento por antigüedad. */
  alpha: number;
  /** Tramo desde el último fix hasta la posición estimada. */
  estimated: boolean;
}

export const KNOWN_ALPHA = 0.5;
export const OLDEST_ALPHA = 0.12;
export const ESTIMATED_ALPHA = 0.3;

/**
 * Segmentos de la traza de un avión: entre fixes sucesivos (más tenues cuanto más viejos) y el
 * tramo estimado del último fix a la cabeza. `head` es la posición mostrada.
 */
export function trailSegments(
  fixes: readonly Fix[],
  head: readonly [number, number],
  opacity: number,
): TrailSegment[] {
  const out: TrailSegment[] = [];
  const known = Math.max(1, fixes.length - 1);
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1] as Fix;
    const b = fixes[i] as Fix;
    const k = i / known; // 1 = el más reciente
    out.push({
      path: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      alpha: (OLDEST_ALPHA + (KNOWN_ALPHA - OLDEST_ALPHA) * k) * opacity,
      estimated: false,
    });
  }
  const last = fixes[fixes.length - 1];
  if (last && (last.lon !== head[0] || last.lat !== head[1])) {
    out.push({
      path: [
        [last.lon, last.lat],
        [head[0], head[1]],
      ],
      alpha: ESTIMATED_ALPHA * opacity,
      estimated: true,
    });
  }
  return out;
}
