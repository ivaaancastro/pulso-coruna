import { decode, encode } from "@msgpack/msgpack";
import { ReplayWindowSchema, fromReplayCoord, type LayerId } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import {
  MOCK_RETENTION_DAYS,
  fleetActivity,
  handleMockReplay,
  mockReplayWindow,
} from "./mock-replay";
import { mockTideLevel } from "./mock-sim";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const FROM = Math.floor((NOW - 3_600_000) / 300_000) * 300_000;
const ALL: LayerId[] = ["bus", "bike", "weather", "sea", "ship", "air", "plane"];

describe("histórico simulado", () => {
  it("la ventana cumple el contrato de la API y sobrevive a MessagePack", () => {
    const w = mockReplayWindow(FROM, FROM + 300_000, ALL, { now: NOW });
    const parsed = ReplayWindowSchema.safeParse(decode(encode(w)));
    expect(parsed.success, JSON.stringify(parsed.error?.issues[0])).toBe(true);
  });

  it("es determinista y coherente entre ventanas contiguas (init = última muestra anterior)", () => {
    const a = mockReplayWindow(FROM, FROM + 300_000, ["bus"], { now: NOW });
    expect(mockReplayWindow(FROM, FROM + 300_000, ["bus"], { now: NOW })).toEqual(a);
    const b = mockReplayWindow(FROM + 300_000, FROM + 600_000, ["bus"], { now: NOW });
    const trackA = a.layers.bus?.kind === "mobile" ? a.layers.bus.tracks : [];
    const trackB = b.layers.bus?.kind === "mobile" ? b.layers.bus.tracks : [];
    const id = trackA.find((t) => t.ts.length > 0)?.id as string;
    const last = trackA.find((t) => t.id === id);
    const next = trackB.find((t) => t.id === id);
    const lastIdx = (last?.ts.length ?? 1) - 1;
    // El estado inicial de la ventana siguiente es la última muestra de la anterior.
    expect(next?.init?.lon).toBe(last?.lon[lastIdx]);
    expect(next?.init?.lat).toBe(last?.lat[lastIdx]);
    expect((next?.init?.dt ?? 0) + 300_000).toBe(last?.ts[lastIdx]);
  });

  it("los buses van por las rutas simuladas (península de A Coruña) a velocidades de ciudad", () => {
    const w = mockReplayWindow(FROM, FROM + 300_000, ["bus"], { now: NOW });
    const tracks = w.layers.bus?.kind === "mobile" ? w.layers.bus.tracks : [];
    expect(tracks.length).toBeGreaterThan(10);
    for (const t of tracks) {
      expect(t.id.startsWith("mock-bus-")).toBe(true);
      expect(t.meta).toMatchObject({ simulated: 1 });
      for (let i = 0; i < t.ts.length; i++) {
        expect(fromReplayCoord(t.lon[i] as number)).toBeGreaterThan(-8.45);
        expect(fromReplayCoord(t.lon[i] as number)).toBeLessThan(-8.39);
      }
    }
  });

  it("ritmo diario: más buses en hora punta que de madrugada", () => {
    const count = (iso: string): number => {
      const from = Math.floor(Date.parse(iso) / 300_000) * 300_000;
      const w = mockReplayWindow(from, from + 300_000, ["bus"], { now: NOW });
      return w.layers.bus?.kind === "mobile" ? w.layers.bus.tracks.length : 0;
    };
    expect(count("2026-11-18T07:30:00Z")).toBeGreaterThan(count("2026-11-18T02:30:00Z") * 3);
    expect(fleetActivity(8)).toBeGreaterThan(fleetActivity(3));
  });

  it("la marea sale de la misma fórmula que el stream simulado", () => {
    const w = mockReplayWindow(FROM, FROM + 300_000, ["sea"], { now: NOW });
    const s = w.layers.sea?.kind === "series" ? w.layers.sea.series[0] : undefined;
    expect(s).toMatchObject({ stationId: "portus:3219", metric: "tide_level" });
    expect(s?.value[0]).toBe(mockTideLevel(FROM));
  });

  it("bicis, viento y aire traen estado inicial; las capas pedidas siempre están", () => {
    const w = mockReplayWindow(FROM, FROM + 300_000, ["bike", "weather", "air"], { now: NOW });
    expect(Object.keys(w.layers).sort()).toEqual(["air", "bike", "weather"]);
    const bike = w.layers.bike?.kind === "station" ? w.layers.bike.stations : [];
    expect(bike.length).toBeGreaterThan(10);
    expect(bike.every((s) => s.init && s.init.dt <= 0)).toBe(true);
    const air = w.layers.air?.kind === "series" ? w.layers.air.series : [];
    expect(air.map((s) => s.metric).sort()).toEqual(["eaqi", "no2", "o3", "pm10", "pm25", "so2"]);
    expect(air.every((s) => s.init)).toBe(true);
  });

  it("más allá de la retención simulada las capas salen vacías (para probar «sin datos»)", () => {
    const old = NOW - (MOCK_RETENTION_DAYS + 2) * 86_400_000;
    const from = Math.floor(old / 300_000) * 300_000;
    const w = mockReplayWindow(from, from + 300_000, ALL, { now: NOW });
    expect(ReplayWindowSchema.safeParse(w).success).toBe(true);
    for (const layer of Object.values(w.layers)) {
      const list =
        layer.kind === "mobile"
          ? layer.tracks
          : layer.kind === "station"
            ? layer.stations
            : layer.series;
      expect(list).toHaveLength(0);
    }
  });
});

describe("respuesta del servidor simulado", () => {
  const ask = (q: string) => handleMockReplay(new URLSearchParams(q), { now: NOW });

  it("200 con una ventana válida y alineada", () => {
    const r = ask(`from=${FROM}&to=${FROM + 300_000}`);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe("application/msgpack");
    expect(r.window?.from).toBe(FROM);
  });

  it("400 como la API real: segundos, ventana larga, futuro, capa desconocida", () => {
    expect(ask("from=1760000000&to=1760000300").status).toBe(400);
    expect(ask(`from=${FROM}&to=${FROM + 600_000}`).status).toBe(400);
    expect(ask(`from=${NOW + 1000}&to=${NOW + 2000}`).status).toBe(400);
    expect(ask(`from=${FROM}&to=${FROM + 300_000}&layers=bus,nada`).status).toBe(400);
    expect(ask(`from=${FROM}&to=${FROM + 300_000}&layers=`).status).toBe(400);
  });

  it("solo las capas pedidas", () => {
    const r = ask(`from=${FROM}&to=${FROM + 300_000}&layers=sea,bus`);
    expect(Object.keys(r.window?.layers ?? {}).sort()).toEqual(["bus", "sea"]);
  });
});
