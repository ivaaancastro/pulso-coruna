import { EntitySchema } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import zipBase64 from "./fixtures/mini-gtfs.zip.b64?raw";
import {
  createBusEstimator,
  estimateBuses,
  madridDate,
  previousDate,
  readGtfsZip,
  serviceDayStartMs,
  type GtfsFiles,
} from "./index.js";

/** Fixture: recorte del feed real (vigencia 2026-11-13 … 2026-12-31, lunes a viernes). */
async function fixtureFiles(): Promise<GtfsFiles> {
  return readGtfsZip(Uint8Array.from(atob(zipBase64.trim()), (c) => c.charCodeAt(0)));
}

/** Hora local de Madrid en invierno (CET, UTC+1) → epoch ms. */
const cet = (iso: string): number => Date.parse(`${iso}+01:00`);

// 2026-11-18 es miércoles; 2026-11-21, sábado.
const WED = "2026-11-18";

describe("tiempo (Europe/Madrid)", () => {
  it("día local y día de servicio en invierno y verano", () => {
    expect(madridDate(Date.parse("2026-11-18T23:30:00Z"))).toBe("20261119"); // 00:30 local
    expect(madridDate(Date.parse("2026-07-15T22:30:00Z"))).toBe("20260716"); // 00:30 local
    expect(serviceDayStartMs("20261118")).toBe(Date.parse("2026-11-17T23:00:00Z"));
    expect(serviceDayStartMs("20260715")).toBe(Date.parse("2026-07-14T22:00:00Z"));
    expect(previousDate("20260301")).toBe("20260228");
  });

  it("el día de servicio es «mediodía local - 12 h» también en los cambios de hora", () => {
    // Fin del horario de verano (2026-10-25) e inicio (2026-03-29): el inicio sigue la definición GTFS.
    expect(serviceDayStartMs("20261025")).toBe(Date.parse("2026-10-24T23:00:00Z"));
    expect(serviceDayStartMs("20260329")).toBe(Date.parse("2026-03-28T22:00:00Z"));
  });
});

describe("estimador con el fixture GTFS", () => {
  it("emite el viaje en circulación como Entity bus estimada", async () => {
    const files = await fixtureFiles();
    const now = cet(`${WED}T06:57:00`); // viaje 100010650: 06:50:00 → 07:04:59
    const out = estimateBuses(files, now);
    const e = out.find((x) => x.id === "sched:100010650");
    expect(e).toBeDefined();
    expect(EntitySchema.safeParse(e).success).toBe(true);
    expect(e).toMatchObject({
      layer: "bus",
      ts: now,
      meta: {
        source: "schedule",
        estimated: 1,
        line: "1",
        routeId: "100",
        headsign: "A. Lago",
        tripId: "100010650",
      },
    });
    expect(typeof e?.meta?.["nextStop"]).toBe("string");
    expect(e?.meta?.["nextStopTs"]).toBeGreaterThan(now - 1);
    expect(e?.speed).toBeGreaterThan(0);
    expect(e?.heading).toBeGreaterThanOrEqual(0);
    expect(e?.heading).toBeLessThan(360);
    expect(e?.lon).toBeGreaterThan(-8.5);
    expect(e?.lon).toBeLessThan(-8.3);
    expect(out.every((x) => x.id.startsWith("sched:") && x.layer === "bus")).toBe(true);
  });

  it("interpreta el horario en Europe/Madrid, no en UTC", async () => {
    const files = await fixtureFiles();
    // 06:57 UTC = 07:57 local: el viaje de las 06:50 local ya terminó.
    const out = estimateBuses(files, Date.parse(`${WED}T06:57:00Z`));
    expect(out.map((x) => x.id)).not.toContain("sched:100010650");
  });

  it("no emite fuera del horario ni en días sin servicio", async () => {
    const files = await fixtureFiles();
    expect(estimateBuses(files, cet(`${WED}T05:00:00`))).toEqual([]); // antes del primer viaje
    expect(estimateBuses(files, cet(`${WED}T23:00:00`))).toEqual([]); // después del último
    expect(estimateBuses(files, cet("2026-11-21T06:57:00"))).toEqual([]); // sábado: sin servicio
    expect(estimateBuses(files, cet("2026-11-10T06:57:00"))).toEqual([]); // antes de la vigencia
  });

  it("feed caducado: no emite nada", async () => {
    const files = await fixtureFiles();
    expect(estimateBuses(files, cet("2026-12-30T06:57:00")).length).toBeGreaterThan(0);
    expect(estimateBuses(files, cet("2027-01-04T06:57:00"))).toEqual([]);
  });

  it("es determinista, está ordenado por id y se mueve con el tiempo", async () => {
    const est = createBusEstimator(await fixtureFiles());
    const t = cet(`${WED}T06:55:00`);
    const a = est.estimate(t);
    expect(est.estimate(t)).toEqual(a);
    expect(a.map((x) => x.id)).toEqual([...a.map((x) => x.id)].sort());
    const b = est.estimate(t + 30_000);
    const p1 = a.find((x) => x.id === "sched:100010650");
    const p2 = b.find((x) => x.id === "sched:100010650");
    expect([p1?.lon, p1?.lat]).not.toEqual([p2?.lon, p2?.lat]);
  });

  it("calendario sin vigencia o archivos ausentes: nada, sin lanzar", () => {
    expect(estimateBuses({}, Date.now())).toEqual([]);
    expect(estimateBuses({ "stops.txt": "stop_id\n" }, Date.now())).toEqual([]);
  });
});

// ------------------------------------------------------------ feed sintético (geometría exacta)

interface Synth {
  stops: [id: string, lon: number, lat: number][];
  shape?: [lon: number, lat: number][];
  times: [stopId: string, arr: string, dep: string][];
  days?: string; // columnas lunes…domingo
  start?: string;
  end?: string;
}
function synth(s: Synth): GtfsFiles {
  const days = s.days ?? "1,1,1,1,1,1,1";
  return {
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      s.stops.map(([id, lon, lat]) => `${id},Parada ${id},${lat},${lon}`).join("\n"),
    "routes.txt": "route_id,route_short_name\nR,L9",
    "trips.txt": `route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nR,S,T1,Destino,0,${s.shape ? "SH" : ""}`,
    "stop_times.txt":
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
      s.times.map(([id, a, d], i) => `T1,${a},${d},${id},${i + 1}`).join("\n"),
    "calendar.txt": `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,${days},${s.start ?? "20261101"},${s.end ?? "20261231"}`,
    "calendar_dates.txt": "service_id,date,exception_type\n",
    "shapes.txt": s.shape
      ? "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        s.shape.map(([lon, lat], i) => `SH,${lat},${lon},${i}`).join("\n")
      : "",
  };
}

const at = (files: GtfsFiles, iso: string) => estimateBuses(files, cet(iso))[0];

describe("interpolación y geometría", () => {
  // A y B separadas ~1110 m hacia el norte; 10 min de trayecto.
  const straight = synth({
    stops: [
      ["A", -8.4, 43.37],
      ["B", -8.4, 43.38],
    ],
    times: [
      ["A", "10:00:00", "10:00:00"],
      ["B", "10:10:00", "10:10:00"],
    ],
  });

  it("sin trazado interpola en línea recta entre paradas, con rumbo y velocidad", () => {
    const e = at(straight, `${WED}T10:05:00`);
    expect(e?.lon).toBeCloseTo(-8.4, 5);
    expect(e?.lat).toBeCloseTo(43.375, 4);
    expect(e?.heading).toBe(0);
    expect(e?.speed).toBeCloseTo(1.8, 1); // 1105 m / 600 s
    expect(e?.meta).toMatchObject({ nextStop: "Parada B", nextStopId: "B", line: "L9" });
  });

  it("sale y llega exactamente en las paradas", () => {
    const start = at(straight, `${WED}T10:00:00`);
    expect(start?.lat).toBeCloseTo(43.37, 5);
    expect(start?.speed).toBe(0);
    expect(start?.meta?.["nextStop"]).toBe("Parada A");
    const end = at(straight, `${WED}T10:10:00`);
    expect(end?.lat).toBeCloseTo(43.38, 5);
    expect(end?.speed).toBe(0);
    expect(end?.heading).toBe(0);
    expect(at(straight, `${WED}T10:10:01`)).toBeUndefined();
  });

  it("se queda quieto durante la parada intermedia", () => {
    const f = synth({
      stops: [
        ["A", -8.4, 43.37],
        ["B", -8.4, 43.375],
        ["C", -8.4, 43.38],
      ],
      times: [
        ["A", "10:00:00", "10:00:00"],
        ["B", "10:05:00", "10:07:00"],
        ["C", "10:12:00", "10:12:00"],
      ],
    });
    const mid = at(f, `${WED}T10:06:00`);
    expect(mid?.lat).toBeCloseTo(43.375, 5);
    expect(mid?.speed).toBe(0);
    expect(mid?.meta?.["nextStop"]).toBe("Parada B");
    expect(at(f, `${WED}T10:09:30`)?.meta?.["nextStop"]).toBe("Parada C");
  });

  it("con trazado sigue la geometría (no la recta) y da el rumbo del tramo", () => {
    // Trazado en L: 0,0 → este ~1 km → norte ~1 km. A al inicio, B al final.
    const shape: [number, number][] = [
      [-8.4, 43.37],
      [-8.3869, 43.37],
      [-8.3869, 43.379],
    ];
    const f = synth({
      stops: [
        ["A", -8.4, 43.37],
        ["B", -8.3869, 43.379],
      ],
      shape,
      times: [
        ["A", "10:00:00", "10:00:00"],
        ["B", "10:10:00", "10:10:00"],
      ],
    });
    const early = at(f, `${WED}T10:02:00`);
    expect(early?.lat).toBeCloseTo(43.37, 5); // todavía en el tramo hacia el este
    expect(early?.heading).toBeGreaterThan(85);
    expect(early?.heading).toBeLessThan(95);
    const late = at(f, `${WED}T10:08:00`);
    expect(late?.lon).toBeCloseTo(-8.3869, 5); // ya en el tramo hacia el norte
    expect(late?.heading).toBeLessThan(5);
    // La velocidad es la del recorrido por el trazado (~2 km / 600 s), mayor que la de la recta.
    expect(early?.speed).toBeGreaterThan(2.9);
  });

  it("descarta el viaje si falta alguna parada en stops.txt", () => {
    const f = synth({
      stops: [["A", -8.4, 43.37]],
      times: [
        ["A", "10:00:00", "10:00:00"],
        ["Z", "10:10:00", "10:10:00"],
      ],
    });
    expect(estimateBuses(f, cet(`${WED}T10:05:00`))).toEqual([]);
  });
});

describe("medianoche y vigencia", () => {
  // Miércoles 23:50 → «24:20:00» (00:20 del jueves).
  const overnight = synth({
    stops: [
      ["A", -8.4, 43.37],
      ["B", -8.4, 43.38],
    ],
    times: [
      ["A", "23:50:00", "23:50:00"],
      ["B", "24:20:00", "24:20:00"],
    ],
    days: "0,0,1,0,0,0,0", // solo miércoles
    end: "20261118",
  });

  it("viaje con horas >24:00: sigue en circulación pasada la medianoche", () => {
    expect(at(overnight, `${WED}T23:55:00`)).toBeDefined();
    const after = at(overnight, "2026-11-19T00:05:00"); // jueves, el servicio es del miércoles
    expect(after?.id).toBe("sched:T1");
    expect(after?.lat).toBeCloseTo(43.375, 4); // mitad del trayecto
    expect(after?.ts).toBe(cet("2026-11-19T00:05:00"));
    expect(after?.meta?.["nextStopTs"]).toBe(cet("2026-11-19T00:20:00"));
    expect(at(overnight, "2026-11-19T00:21:00")).toBeUndefined();
  });

  it("el último servicio vigente termina de circular tras la medianoche; después, nada", () => {
    // end_date = miércoles: el jueves a las 00:05 sigue el viaje, el jueves a las 10:00 no hay servicio.
    expect(at(overnight, "2026-11-19T00:05:00")).toBeDefined();
    expect(at(overnight, "2026-11-19T10:00:00")).toBeUndefined();
    expect(at(overnight, "2026-11-25T23:55:00")).toBeUndefined(); // otro miércoles, fuera de vigencia
  });

  it("zona horaria de verano (CEST) también se respeta", () => {
    const summer = synth({
      stops: [
        ["A", -8.4, 43.37],
        ["B", -8.4, 43.38],
      ],
      times: [
        ["A", "10:00:00", "10:00:00"],
        ["B", "10:10:00", "10:10:00"],
      ],
      start: "20260701",
      end: "20260731",
    });
    // 2026-07-15 10:05 local = 08:05 UTC.
    expect(estimateBuses(summer, Date.parse("2026-07-15T08:05:00Z"))).toHaveLength(1);
    expect(estimateBuses(summer, Date.parse("2026-07-15T09:05:00Z"))).toHaveLength(0);
  });
});
