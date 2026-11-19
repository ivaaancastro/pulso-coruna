import { describe, expect, it } from "vitest";
import { WsMessageSchema, type Entity, type Observation, type StationStatus } from "@pulso/schema";
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
    const air = (snap.layers.air ?? []) as Observation[];
    expect(air.map((o) => o.metric).sort()).toEqual(["eaqi", "no2", "o3", "pm10", "pm25", "so2"]);
    // dato de modelo: lo marca el sufijo del stationId, como en producción
    expect(air.every((o) => o.stationId.endsWith(":model"))).toBe(true);

    const layers = new Set<string>();
    for (let t = 1; t <= 120; t++) {
      for (const d of w.step(NOW + t * 1000)) {
        expect(WsMessageSchema.safeParse(d).success).toBe(true);
        layers.add(d.layer);
      }
    }
    expect([...layers].sort()).toEqual(["air", "bike", "bus", "weather"]);
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
