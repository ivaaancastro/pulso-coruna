import { describe, expect, it } from "vitest";
import { COVERAGE, createWindField, windToVector, type WindSample } from "./field";
import {
  allocateSegmentBuffers,
  clampQuality,
  createRng,
  MIN_QUALITY,
  ParticleSystem,
  TIMELAPSE,
} from "./particles";

const station = (speed: number, from: number, lon = -8.42, lat = 43.37): WindSample => ({
  stationId: "S",
  lon,
  lat,
  ...windToVector(speed, from),
});
const RGB = [201, 220, 245] as const;

function run(
  sys: ParticleSystem,
  field: ReturnType<typeof createWindField>,
  seconds: number,
): void {
  for (let t = 0; t < seconds; t += 1 / 60) sys.step(1 / 60, field);
}

describe("calidad", () => {
  it("se recorta a [MIN_QUALITY, 1] y descarta NaN", () => {
    expect(clampQuality(2)).toBe(1);
    expect(clampQuality(-1)).toBe(MIN_QUALITY);
    expect(clampQuality(0)).toBe(MIN_QUALITY);
    expect(clampQuality(Number.NaN)).toBe(1);
    expect(clampQuality(0.5)).toBe(0.5);
  });

  it("escala las partículas activas y acorta la estela", () => {
    const sys = new ParticleSystem({ maxParticles: 1000, trailPoints: 10 });
    expect(sys.activeCount).toBe(1000);
    expect(sys.trailPoints).toBe(10);
    sys.setQuality(0.5);
    expect(sys.activeCount).toBe(500);
    expect(sys.trailPoints).toBe(7);
    sys.setQuality(0);
    expect(sys.activeCount).toBe(100);
    expect(sys.trailPoints).toBe(5);
  });

  it("con menos calidad se dibujan menos segmentos", () => {
    const field = createWindField([station(6, 270)]);
    const make = (q: number): number => {
      const sys = new ParticleSystem({ maxParticles: 400, rng: createRng(3), quality: q });
      run(sys, field, 3);
      return sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1);
    };
    const high = make(1);
    const mid = make(0.5);
    const low = make(0.2);
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it("no excede el búfer a máxima calidad", () => {
    const field = createWindField([station(6, 270)]);
    const sys = new ParticleSystem({ maxParticles: 200, trailPoints: 8, rng: createRng(1) });
    run(sys, field, 4);
    expect(sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1)).toBeLessThanOrEqual(
      sys.maxSegments,
    );
  });
});

describe("movimiento", () => {
  it("es determinista con la misma semilla", () => {
    const field = createWindField([station(5, 200)]);
    const a = new ParticleSystem({ maxParticles: 50, rng: createRng(7) });
    const b = new ParticleSystem({ maxParticles: 50, rng: createRng(7) });
    run(a, field, 2);
    run(b, field, 2);
    expect(a.head(10)).toEqual(b.head(10));
  });

  it("las partículas van hacia donde sopla el aire (del oeste → hacia el este)", () => {
    const field = createWindField([station(8, 270)]);
    const sys = new ParticleSystem({ maxParticles: 40, rng: createRng(2) });
    sys.step(1 / 60, field); // nacen
    const before = Array.from({ length: 40 }, (_, i) => sys.head(i));
    sys.step(0.05, field);
    let moved = 0;
    for (let i = 0; i < 40; i++) {
      const [x0, y0] = before[i] as [number, number];
      const [x1, y1] = sys.head(i);
      if (Math.abs(x1 - x0) > 0.01) continue; // renació en otro sitio
      moved++;
      expect(x1).toBeGreaterThan(x0);
      expect(y1).toBeCloseTo(y0, 6);
    }
    expect(moved).toBeGreaterThan(30);
  });

  it("el desplazamiento es proporcional a la velocidad del viento", () => {
    const dist = (speed: number): number => {
      const field = createWindField([station(speed, 270)]);
      const sys = new ParticleSystem({ maxParticles: 1, rng: createRng(9) });
      sys.step(1 / 60, field);
      const [x0] = sys.head(0);
      sys.step(0.3, field);
      const [x1] = sys.head(0);
      return (x1 - x0) * Math.cos((43.37 * Math.PI) / 180) * 111_320;
    };
    const slow = dist(2);
    const fast = dist(8);
    expect(fast / slow).toBeCloseTo(4, 1);
    expect(fast).toBeCloseTo(8 * TIMELAPSE * 0.3, 0);
  });

  it("siempre se mantienen dentro de la cobertura y renacen", () => {
    const field = createWindField([station(14, 270)]);
    const sys = new ParticleSystem({ maxParticles: 200, rng: createRng(5) });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let t = 0; t < 30; t += 1 / 30) {
      sys.step(1 / 30, field);
      for (let i = 0; i < 200; i++) {
        const [x, y] = sys.head(i);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    // Una partícula que sale se reemplaza en el paso siguiente: se tolera un paso de margen.
    const margin = 0.01;
    expect(minX).toBeGreaterThan(COVERAGE.west - margin);
    expect(maxX).toBeLessThan(COVERAGE.east + margin);
    expect(minY).toBeGreaterThan(COVERAGE.south - margin);
    expect(maxY).toBeLessThan(COVERAGE.north + margin);
  });

  it("sin campo (sin datos) no avanza ni dibuja", () => {
    const sys = new ParticleSystem({ maxParticles: 10, rng: createRng(1) });
    sys.step(0.1, createWindField([]));
    expect(sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1)).toBe(0);
  });

  it("en calma las partículas se desvanecen: no se dibuja nada", () => {
    const field = createWindField([station(0, 0)]);
    const sys = new ParticleSystem({ maxParticles: 50, rng: createRng(4) });
    run(sys, field, 2);
    expect(sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1)).toBe(0);
  });

  it("lejos de toda estación se desvanecen (confianza 0)", () => {
    // Única estación a unos 40 km al este: toda la cobertura queda fuera de su radio.
    const field = createWindField([station(8, 270, -7.9, 43.37)]);
    const sys = new ParticleSystem({ maxParticles: 50, rng: createRng(4) });
    run(sys, field, 2);
    expect(sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1)).toBe(0);
  });

  it("reset hace renacer todas", () => {
    const field = createWindField([station(6, 270)]);
    const sys = new ParticleSystem({ maxParticles: 30, rng: createRng(1) });
    run(sys, field, 2);
    sys.reset();
    expect(sys.fill(allocateSegmentBuffers(sys.maxSegments), RGB, 1)).toBe(0);
  });
});

describe("estelas", () => {
  it("el alfa baja hacia la cola, con color de token y valores válidos", () => {
    const field = createWindField([station(6, 270)]);
    const sys = new ParticleSystem({ maxParticles: 20, trailPoints: 8, rng: createRng(1) });
    run(sys, field, 3);
    const buf = allocateSegmentBuffers(sys.maxSegments);
    const n = sys.fill(buf, RGB, 0.9);
    expect(n).toBeGreaterThan(0);
    // Segmentos consecutivos de una misma partícula: 7 por partícula (trailPoints − 1).
    for (let p = 0; p + 7 <= n; p += 7) {
      for (let k = 1; k < 7; k++) {
        expect(buf.color[(p + k) * 4 + 3] as number).toBeLessThanOrEqual(
          buf.color[(p + k - 1) * 4 + 3] as number,
        );
      }
      expect(buf.color[p * 4]).toBe(201);
      expect(buf.color[p * 4 + 1]).toBe(220);
      expect(buf.color[p * 4 + 2]).toBe(245);
      expect(buf.color[p * 4 + 3] as number).toBeLessThanOrEqual(Math.round(0.9 * 255));
    }
  });
});
