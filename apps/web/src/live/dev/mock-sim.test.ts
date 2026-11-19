import { describe, expect, it } from "vitest";
import { WsMessageSchema, type Entity, type StationStatus } from "@pulso/schema";
import { MockWorld, createRng } from "./mock-sim";
import { CLOSE_FRAME, PONG_FRAME, encodeTextFrame, frameOpcode } from "./ws-frame";

const NOW = 1_760_000_000_000;

describe("MockWorld", () => {
  it("snapshot y deltas cumplen el contrato del WebSocket", () => {
    const w = new MockWorld({ buses: 40, seed: 3 });
    const snap = w.snapshot(NOW);
    expect(WsMessageSchema.safeParse(snap).success).toBe(true);
    expect(snap.layers.bus?.length).toBe(40);
    expect(snap.layers.bike?.length).toBeGreaterThan(10);
    expect(snap.layers.weather?.length).toBeGreaterThan(0);

    const layers = new Set<string>();
    for (let t = 1; t <= 120; t++) {
      for (const d of w.step(NOW + t * 1000)) {
        expect(WsMessageSchema.safeParse(d).success).toBe(true);
        layers.add(d.layer);
      }
    }
    expect([...layers].sort()).toEqual(["bike", "bus", "ship", "weather"]);
  });

  it("los datos simulados se identifican como tales", () => {
    const snap = new MockWorld({ buses: 5 }).snapshot(NOW);
    for (const e of (snap.layers.bus ?? []) as Entity[]) {
      expect(e.id.startsWith("mock-")).toBe(true);
      expect(e.meta?.simulated).toBe(1);
    }
  });

  it("los buses llevan línea, destino y próxima parada; la mitad se marca como estimada", () => {
    const buses = (new MockWorld({ buses: 6 }).snapshot(NOW).layers.bus ?? []) as Entity[];
    for (const e of buses) {
      expect(e.meta?.line).toBeTruthy();
      expect(e.meta?.headsign).toBeTruthy();
      expect(e.meta?.nextStop).toBeTruthy();
    }
    expect(buses.filter((e) => e.meta?.estimated === 1)).toHaveLength(3);
  });

  it("las bicis conservan la capacidad y los buses se mueven y desaparecen/reaparecen", () => {
    const w = new MockWorld({ buses: 200, seed: 5, busIntervalMs: 1000, bikeIntervalMs: 1000 });
    const snap = w.snapshot(NOW);
    const capacity = new Map(
      ((snap.layers.bike ?? []) as StationStatus[]).map((s) => [s.id, s.bikes + s.docks]),
    );
    let removes = 0;
    let moved = false;
    const first = new Map(((snap.layers.bus ?? []) as Entity[]).map((b) => [b.id, b]));
    for (let t = 1; t <= 60; t++) {
      for (const d of w.step(NOW + t * 1000)) {
        if (d.layer === "bike") {
          for (const s of d.upserts as StationStatus[]) {
            expect(s.bikes + s.docks).toBe(capacity.get(s.id));
          }
        }
        if (d.layer === "bus") {
          removes += d.removes.length;
          for (const b of d.upserts as Entity[]) {
            const before = first.get(b.id);
            if (before && b.lon !== before.lon) moved = true;
          }
        }
      }
    }
    expect(moved).toBe(true);
    expect(removes).toBeGreaterThan(0);
  });

  it("es determinista con la misma semilla", () => {
    const a = new MockWorld({ buses: 10, seed: 9 }).snapshot(NOW);
    const b = new MockWorld({ buses: 10, seed: 9 }).snapshot(NOW);
    expect(a).toEqual(b);
    expect(createRng(1)()).toBe(createRng(1)());
  });
});

describe("tramas WebSocket", () => {
  it("codifica longitudes cortas, medias y largas", () => {
    expect(Array.from(encodeTextFrame("hi"))).toEqual([0x81, 2, 104, 105]);
    const mid = encodeTextFrame("a".repeat(300));
    expect(Array.from(mid.slice(0, 4))).toEqual([0x81, 126, 1, 44]);
    expect(mid.length).toBe(4 + 300);
    const big = encodeTextFrame("a".repeat(70_000));
    expect(Array.from(big.slice(0, 10))).toEqual([0x81, 127, 0, 0, 0, 0, 0, 1, 17, 112]);
    expect(big.length).toBe(10 + 70_000);
  });

  it("opcodes de control", () => {
    expect(frameOpcode(new Uint8Array([0x88, 0x80]))).toBe(8);
    expect(frameOpcode(new Uint8Array([0x89, 0x80]))).toBe(9);
    expect(PONG_FRAME[0]).toBe(0x8a);
    expect(CLOSE_FRAME[0]).toBe(0x88);
  });
});

describe("MockWorld: barcos", () => {
  it("emite barcos ficticios válidos, con tipo, estado y sin MMSI", () => {
    const snap = new MockWorld({ seed: 2 }).snapshot(NOW);
    const ships = (snap.layers.ship ?? []) as Entity[];
    expect(WsMessageSchema.safeParse(snap).success).toBe(true);
    expect(ships.length).toBeGreaterThanOrEqual(10);
    for (const s of ships) {
      expect(s.id.startsWith("mock-ship-")).toBe(true);
      expect(s.meta?.simulated).toBe(1);
    }
    expect(ships.some((s) => s.speed === 0 && s.meta?.navStatus === 5)).toBe(true);
    expect(ships.some((s) => (s.speed ?? 0) > 0)).toBe(true);
    expect(ships.some((s) => s.meta?.shipType === 37 && s.meta?.name)).toBe(true);
  });

  it("los barcos entran, atracan, salen y vuelven a entrar; informan de forma esporádica", () => {
    const w = new MockWorld({ seed: 4, ships: 8 });
    w.snapshot(NOW);
    let reports = 0;
    let removes = 0;
    let docked = false;
    for (let t = 1; t <= 4000; t++) {
      for (const d of w.step(NOW + t * 1000)) {
        expect(WsMessageSchema.safeParse(d).success).toBe(true);
        if (d.layer !== "ship") continue;
        reports += d.upserts.length;
        removes += d.removes.length;
        if ((d.upserts as Entity[]).some((e) => e.speed === 0 && e.meta?.navStatus === 5))
          docked = true;
      }
    }
    expect(docked).toBe(true);
    expect(removes).toBeGreaterThan(0);
    // 8 barcos × 4000 s: un informe cada pocos segundos como mucho, nunca uno por segundo y barco.
    expect(reports).toBeGreaterThan(300);
    expect(reports).toBeLessThan(8 * 4000);
  }, 20_000);

  it("`ships: 0` no simula barcos", () => {
    expect(new MockWorld({ ships: 0 }).snapshot(NOW).layers.ship).toEqual([]);
  });

  it("atracado, el barco se informa en el muelle (final de su ruta), no en la bocana", () => {
    const ends: [number, number][] = [
      [-8.3851, 43.3637],
      [-8.3792, 43.3613],
      [-8.3823, 43.363],
    ];
    const w = new MockWorld({ seed: 4, ships: 3 });
    w.snapshot(NOW);
    let docked: Entity | undefined;
    for (let t = 1; t <= 4000 && !docked; t++) {
      for (const d of w.step(NOW + t * 1000)) {
        if (d.layer !== "ship") continue;
        docked ??= (d.upserts as Entity[]).find((e) => e.speed === 0);
      }
    }
    expect(docked).toBeDefined();
    const { lon = 0, lat = 0 } = docked ?? {};
    const near = ends.some(([x, y]) => Math.hypot(lon - x, lat - y) < 1e-3);
    expect(near).toBe(true);
  });
});
