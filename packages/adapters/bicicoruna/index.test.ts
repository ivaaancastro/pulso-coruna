import { describe, expect, it } from "vitest";
import { StationStatusSchema } from "@pulso/schema";
import rawFixture from "./fixtures/getAssets.json";
import { bicicorunaAdapter, parseStations } from "./index.js";

const fixture: unknown = rawFixture;
const TS = 1_763_466_000_000;
const station = (over: Record<string, unknown>) => ({
  BikeHireDockingStation: {
    id: "1",
    status: "working",
    availableBikeNumber: 3,
    freeSlotNumber: 5,
    location: { coordinates: [43.36, -8.41] },
    ...over,
  },
});

describe("bicicoruna parse", () => {
  it("mapea la fixture real (lat/lon invertidos, bikes y docks libres)", () => {
    const out = bicicorunaAdapter.parse({ fetchedAt: TS, body: fixture });
    expect(out).toEqual([
      { id: "10", layer: "bike", lat: 43.3539722, lon: -8.3904889, bikes: 2, docks: 17, ts: TS },
      { id: "11", layer: "bike", lat: 43.3743246, lon: -8.4319872, bikes: 16, docks: 9, ts: TS },
    ]);
    out.forEach((s) => expect(StationStatusSchema.safeParse(s).success).toBe(true));
  });

  it("respuesta vacía => []", () => {
    expect(parseStations([], TS)).toEqual([]);
  });

  it("cuerpo que no es array lanza", () => {
    expect(() => parseStations({ error: "x" }, TS)).toThrow();
    expect(() => bicicorunaAdapter.parse(fixture)).toThrow();
  });

  it("campo ausente => descarta esa estación, conserva el resto", () => {
    const out = parseStations(
      [
        station({ id: "1", availableBikeNumber: undefined }),
        station({ id: "2", freeSlotNumber: undefined }),
        station({ id: "3" }),
        { sin: "estacion" },
      ],
      TS,
    );
    expect(out.map((s) => s.id)).toEqual(["3"]);
  });

  it("coordenadas inválidas o fuera de A Coruña => se descartan sin romper", () => {
    const out = parseStations(
      [
        station({ id: "1", location: {} }),
        station({ id: "2", location: { coordinates: ["x", "y"] } }),
        station({ id: "3", location: { coordinates: [-8.41, 43.36] } }),
        station({ id: "4", location: { coordinates: [0, 0] } }),
        station({ id: "5" }),
      ],
      TS,
    );
    expect(out.map((s) => s.id)).toEqual(["5"]);
  });

  it("contadores negativos o no enteros => se descartan", () => {
    expect(parseStations([station({ availableBikeNumber: -1 })], TS)).toEqual([]);
    expect(parseStations([station({ freeSlotNumber: 1.5 })], TS)).toEqual([]);
  });

  it("estación fuera de servicio => bikes y docks a 0", () => {
    const [s] = parseStations([station({ status: "outOfService" })], TS);
    expect(s).toMatchObject({ bikes: 0, docks: 0 });
  });

  it("metadatos del adaptador", () => {
    expect(bicicorunaAdapter.id).toBe("bicicoruna");
    expect(bicicorunaAdapter.intervalMs).toBe(60_000);
  });
});
