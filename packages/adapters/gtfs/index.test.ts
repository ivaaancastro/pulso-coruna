import { describe, expect, it } from "vitest";
import zipBase64 from "./fixtures/mini-gtfs.zip.b64?raw";
import {
  activeServiceIds,
  buildDaySchedule,
  csvRecords,
  csvRows,
  daysUntilExpiry,
  GTFS_ATTRIBUTION,
  gtfsAdapter,
  parseCoordinate,
  parseGtfs,
  parseGtfsTime,
  readCalendar,
  readCalendarDates,
  readGtfsZip,
  readStopTimes,
  readTrips,
  unzip,
  type GtfsFiles,
} from "./index.js";

/** Fixture: recorte del feed real (2 rutas, 4 viajes, 15 paradas por viaje, 12 puntos por trazado). */
function fixtureZip(): Uint8Array {
  return Uint8Array.from(atob(zipBase64.trim()), (c) => c.charCodeAt(0));
}

describe("zip", () => {
  it("lee los 8 archivos del feed", async () => {
    const files = await readGtfsZip(fixtureZip());
    expect(Object.keys(files).sort()).toEqual([
      "agency.txt",
      "calendar.txt",
      "calendar_dates.txt",
      "routes.txt",
      "shapes.txt",
      "stop_times.txt",
      "stops.txt",
      "trips.txt",
    ]);
    expect(files["routes.txt"]).toContain("Abente y Lago-Castrillón");
  });

  it("rechaza bytes que no son un zip", async () => {
    await expect(unzip(new Uint8Array(100))).rejects.toThrow(/directorio central/);
  });
});

describe("csv", () => {
  it("gestiona comillas, comas, comillas escapadas, CRLF, BOM y líneas en blanco", () => {
    const text = '﻿a,b,c\r\n1,"x, y","di ""hola"""\r\n\r\n2,,\n';
    expect([...csvRows(text)]).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'di "hola"'],
      ["2", "", ""],
    ]);
  });

  it("deja undefined las columnas ausentes en filas cortas", () => {
    expect([...csvRecords("a,b\n1\n")]).toEqual([{ a: "1" }]);
  });

  it("texto vacío no da filas", () => {
    expect([...csvRows("")]).toEqual([]);
  });
});

describe("parse (fixture real recortada)", () => {
  it("produce rutas, paradas y trazados válidos", async () => {
    const [feed] = parseGtfs(await readGtfsZip(fixtureZip()));
    if (!feed) throw new Error("feed vacío");

    expect(feed.routes.features.map((f) => f.id)).toEqual(["100", "200"]);
    const r100 = feed.routes.features[0];
    expect(r100?.properties).toMatchObject({
      shortName: "1",
      longName: "Abente y Lago-Castrillón",
    });
    expect(r100?.geometry.type).toBe("MultiLineString");
    expect(r100?.geometry.coordinates).toHaveLength(r100?.properties.shapeIds.length ?? -1);

    expect(feed.shapes.features).toHaveLength(4);
    for (const s of feed.shapes.features) {
      expect(s.geometry.coordinates).toHaveLength(12);
    }

    expect(feed.stops.features.length).toBeGreaterThan(10);
    const stop = feed.stops.features.find((f) => f.id === "2" || f.id === "68");
    expect(stop?.properties.name).toBeTruthy();
    for (const f of [...feed.stops.features, ...feed.shapes.features]) {
      const coords =
        f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const [lon, lat] of coords) {
        expect(lon).toBeGreaterThan(-8.6);
        expect(lon).toBeLessThan(-8.3);
        expect(lat).toBeGreaterThan(43.25);
        expect(lat).toBeLessThan(43.45);
      }
    }

    expect(feed.validity).toEqual({ from: "20261113", to: "20261231" });
    expect(feed.stats).toEqual({
      droppedStops: 0,
      droppedShapePoints: 0,
      droppedShapes: 0,
      routesWithoutShape: 0,
    });
  });

  it("es determinista", async () => {
    const files = await readGtfsZip(fixtureZip());
    expect(JSON.stringify(parseGtfs(files))).toBe(JSON.stringify(parseGtfs(files)));
  });

  it("vacío: sin datos devuelve []", () => {
    expect(parseGtfs({})).toEqual([]);
    expect(parseGtfs(null)).toEqual([]);
    expect(parseGtfs("zip")).toEqual([]);
    expect(parseGtfs({ "stops.txt": "stop_id,stop_lat,stop_lon\n" })).toEqual([]);
  });

  it("campo ausente o inválido: descarta la fila y lo cuenta", () => {
    const files: GtfsFiles = {
      "stops.txt": [
        "stop_id,stop_name,stop_lat,stop_lon",
        "1,Buena,43.37,-8.40",
        "2,SinLat,,-8.40",
        "3,Fuera,40.4,-3.7",
        "4,NaN,abc,-8.40",
        ",SinId,43.37,-8.40",
        "1,Duplicada,43.37,-8.40",
        "5,,43.371,-8.401",
      ].join("\n"),
      "shapes.txt": [
        "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence",
        "S,43.371,-8.401,2",
        "S,43.370,-8.400,1",
        "S,0,0,3",
        "S,43.372,-8.402,x",
        "T,43.37,-8.40,1",
      ].join("\n"),
      "routes.txt": "route_id,route_short_name\nR,7\nQ,9\n",
      "trips.txt": "route_id,service_id,trip_id,shape_id\nR,s,t1,S\n",
    };
    const [feed] = parseGtfs(files);
    expect(feed?.stops.features.map((f) => f.id)).toEqual(["1", "5"]);
    expect(feed?.stops.features[1]?.properties.name).toBe("5");
    expect(feed?.stats.droppedStops).toBe(5);
    expect(feed?.shapes.features.map((f) => f.id)).toEqual(["S"]);
    // ordenado por secuencia, no por orden de aparición
    expect(feed?.shapes.features[0]?.geometry.coordinates).toEqual([
      [-8.4, 43.37],
      [-8.401, 43.371],
    ]);
    expect(feed?.stats.droppedShapePoints).toBe(2);
    expect(feed?.stats.droppedShapes).toBe(1);
    expect(feed?.routes.features.map((f) => f.id)).toEqual(["R"]);
    expect(feed?.stats.routesWithoutShape).toBe(1);
    expect(feed?.validity).toBeNull();
  });

  it("parseCoordinate valida y redondea", () => {
    expect(parseCoordinate("-8.3958501234", "43.3701151234")).toEqual([-8.39585, 43.370115]);
    expect(parseCoordinate("-8.39", undefined)).toBeNull();
    expect(parseCoordinate("-8.39", "  ")).toBeNull();
    expect(parseCoordinate("-3.7", "40.4")).toBeNull();
  });

  it("expone atribución e intervalo del adaptador", () => {
    expect(GTFS_ATTRIBUTION).toMatch(/Tranvías de A Coruña/);
    expect(gtfsAdapter.id).toBe("gtfs-tranvias");
    expect(gtfsAdapter.intervalMs).toBeGreaterThanOrEqual(24 * 3600 * 1000);
  });

  it("daysUntilExpiry cuenta días y avisa de caducidad", () => {
    expect(daysUntilExpiry("20261231", Date.UTC(2026, 10, 18))).toBe(43);
    expect(daysUntilExpiry("20261231", Date.UTC(2027, 0, 2))).toBeLessThan(0);
  });
});

describe("horarios", () => {
  it("parseGtfsTime admite horas ≥ 24 y rechaza basura", () => {
    expect(parseGtfsTime("06:50:58")).toBe(6 * 3600 + 50 * 60 + 58);
    expect(parseGtfsTime("25:10:00")).toBe(25 * 3600 + 600);
    expect(parseGtfsTime("")).toBeNull();
    expect(parseGtfsTime(undefined)).toBeNull();
    expect(parseGtfsTime("6:99:00")).toBeNull();
  });

  it("calendario: regla semanal, bajas y altas", () => {
    const calendar = readCalendar(
      [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "A,1,1,1,1,1,0,0,20261113,20261231",
        "B,0,0,0,0,0,1,1,20261113,20261231",
        "C,1,1,1,1,1,1,1,bad,20261231",
      ].join("\n"),
    );
    expect([...calendar.keys()]).toEqual(["A", "B"]);
    const ex = readCalendarDates(
      "service_id,date,exception_type\nA,20261118,2\nB,20261118,1\nA,20261119,9\nA,20251201,2\n",
      new Set(["20261118", "20261119"]),
    );
    expect([...ex.keys()]).toEqual(["20261118"]);
    expect([...activeServiceIds(calendar, new Map(), "20261118")]).toEqual(["A"]); // miércoles
    expect([...activeServiceIds(calendar, ex, "20261118")]).toEqual(["B"]);
    expect([...activeServiceIds(calendar, new Map(), "20261121")]).toEqual(["B"]); // sábado
    expect(activeServiceIds(calendar, new Map(), "20261112").size).toBe(0);
    expect(activeServiceIds(calendar, new Map(), "20270105").size).toBe(0);
  });

  it("stop_times: agrupa, ordena por secuencia y tolera huecos", () => {
    const text = [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "t1,06:00:00,06:00:30,a,2",
      "t1,05:59:00,05:59:00,z,1",
      "t1,,,b,3",
      "t1,25:00:00,,c,4",
      "t2,07:00:00,07:00:00,a,1",
      ",07:00:00,07:00:00,a,1",
    ].join("\n");
    const all = readStopTimes(text);
    expect([...all.keys()]).toEqual(["t1", "t2"]);
    expect(all.get("t1")).toEqual({
      stopIds: ["z", "a", "c"],
      arrivals: [5 * 3600 + 59 * 60, 6 * 3600, 25 * 3600],
      departures: [5 * 3600 + 59 * 60, 6 * 3600 + 30, 25 * 3600],
    });
    expect([...readStopTimes(text, new Set(["t2"])).keys()]).toEqual(["t2"]);
    expect(readStopTimes("foo,bar\n1,2\n").size).toBe(0);
    expect(readStopTimes(undefined).size).toBe(0);
  });

  it("trips: lee campos opcionales y filtra", () => {
    const trips = readTrips(
      "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n100,s1,t1,A. Lago,1,10001\n100,s1,t2,,,\n,s1,t3,,,\n",
    );
    expect(trips.get("t1")).toEqual({
      tripId: "t1",
      routeId: "100",
      serviceId: "s1",
      headsign: "A. Lago",
      directionId: 1,
      shapeId: "10001",
    });
    expect(trips.get("t2")).toEqual({ tripId: "t2", routeId: "100", serviceId: "s1" });
    expect(trips.has("t3")).toBe(false);
  });

  it("buildDaySchedule con la fixture: viajes del día ordenados, y vacío si no hay servicio", async () => {
    const files = await readGtfsZip(fixtureZip());
    // 2026-11-18 es miércoles, laborable.
    const day = buildDaySchedule(files, "20261118");
    expect(day.length).toBeGreaterThan(0);
    for (let i = 1; i < day.length; i++) {
      expect(day[i]?.startSec).toBeGreaterThanOrEqual(day[i - 1]?.startSec ?? 0);
    }
    for (const t of day) {
      expect(t.stops.stopIds).toHaveLength(15);
      expect(t.endSec).toBeGreaterThan(t.startSec);
    }
    expect(JSON.stringify(buildDaySchedule(files, "20261118"))).toBe(JSON.stringify(day));
    // Fuera de vigencia: sin servicios.
    expect(buildDaySchedule(files, "20270105")).toEqual([]);
    expect(buildDaySchedule({}, "20261118")).toEqual([]);
  });
});
