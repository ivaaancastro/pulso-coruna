import { describe, expect, it } from "vitest";
import {
  ESTIMATED_ALPHA,
  FixHistory,
  KNOWN_ALPHA,
  MAX_FIXES,
  MAX_FIX_GAP_MS,
  OLDEST_ALPHA,
  trailSegments,
} from "./history";
import type { PlaneInfo } from "./meta";

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const p = (id: string, min: number, lon: number): PlaneInfo => ({
  id,
  lon,
  lat: 43.3,
  ts: T0 + min * MIN,
  onGround: false,
});

describe("FixHistory", () => {
  it("guarda un fix por ts distinto y descarta repetidos y retrocesos", () => {
    const h = new FixHistory();
    h.record([p("a", 0, -8.5)], T0);
    h.record([p("a", 0, -8.5)], T0 + 1000);
    h.record([p("a", -1, -8.6)], T0 + 2000);
    h.record([p("a", 5, -8.4)], T0 + 5 * MIN);
    expect(h.get("a").map((f) => f.lon)).toEqual([-8.5, -8.4]);
  });

  it("limita el número de fixes y olvida los viejos y los aviones que ya no están", () => {
    const h = new FixHistory();
    for (let i = 0; i < MAX_FIXES + 3; i++)
      h.record([p("a", i * 5, -8.5 + i * 0.01)], T0 + i * 5 * MIN);
    expect(h.get("a")).toHaveLength(MAX_FIXES);
    h.record([p("a", (MAX_FIXES + 3) * 5, -8)], T0 + 100 * MIN);
    expect(h.get("a")).toHaveLength(1); // los de más de 30 min se olvidan, queda el último
    h.record([], T0 + 101 * MIN);
    expect(h.size).toBe(0);
  });

  it("un hueco largo reinicia la traza (salió de la caja y volvió)", () => {
    const h = new FixHistory();
    h.record([p("a", 0, -8.5)], T0);
    h.record([p("a", MAX_FIX_GAP_MS / MIN + 1, -8.2)], T0 + 13 * MIN);
    expect(h.get("a")).toHaveLength(1);
  });
});

describe("trailSegments", () => {
  const fix = (min: number, lon: number) => ({ ts: T0 + min * MIN, lon, lat: 43.3 });

  it("un solo fix: solo el tramo estimado hasta la cabeza", () => {
    const s = trailSegments([fix(0, -8.5)], [-8.45, 43.3], 1);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ estimated: true, alpha: ESTIMATED_ALPHA });
  });

  it("varios fixes: tramos conocidos más tenues cuanto más viejos y uno estimado", () => {
    const s = trailSegments([fix(0, -8.6), fix(5, -8.5), fix(10, -8.4)], [-8.35, 43.3], 1);
    expect(s.map((x) => x.estimated)).toEqual([false, false, true]);
    expect(s[0]?.alpha).toBeCloseTo(OLDEST_ALPHA + (KNOWN_ALPHA - OLDEST_ALPHA) / 2, 9);
    expect(s[1]?.alpha).toBeCloseTo(KNOWN_ALPHA, 9);
    expect((s[0]?.alpha ?? 0) < (s[1]?.alpha ?? 0)).toBe(true);
  });

  it("la opacidad por edad atenúa toda la traza; sin movimiento no hay tramo estimado", () => {
    const s = trailSegments([fix(0, -8.5), fix(5, -8.4)], [-8.4, 43.3], 0.5);
    expect(s).toHaveLength(1);
    expect(s[0]?.alpha).toBeCloseTo(KNOWN_ALPHA * 0.5, 9);
    expect(trailSegments([], [-8.4, 43.3], 1)).toEqual([]);
  });
});
