import { describe, expect, it } from "vitest";
import { LOCALES, type MessageKey } from "../i18n";
import { SOURCES } from "./sources";

/** Ids de `source_health` que registran los adaptadores (`apps/ingest/src/registry.ts`). */
const INGEST_IDS = [
  "bicicoruna",
  "meteogalicia",
  "portus",
  "openmeteo-air",
  "itranvias",
  "opensky",
  "aisstream",
  "bus-schedule",
  "gtfs-tranvias",
];

describe("catálogo de fuentes y créditos", () => {
  it("claves únicas y ningún id de salud repetido ni inventado", () => {
    const keys = SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = SOURCES.flatMap((s) => s.healthIds);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(INGEST_IDS).toContain(id);
  });

  it("todo enlace es https y toda fuente tiene atribución", () => {
    for (const s of SOURCES) {
      expect(s.attribution.trim(), s.key).not.toBe("");
      expect(s.url, s.key).toMatch(/^https:\/\//);
      if (s.license) expect(s.license.url, s.key).toMatch(/^https:\/\//);
    }
  });

  it("licencias: solo las documentadas en docs/sources; el resto queda pendiente (null)", () => {
    const byKey = new Map(SOURCES.map((s) => [s.key, s.license]));
    expect(byKey.get("meteogalicia")?.name).toBe("CC BY-SA 4.0");
    expect(byKey.get("osm")?.name).toBe("ODbL");
    expect(byKey.get("bicicoruna")).toMatchObject({ name: "RISP_AC", unverified: true });
    for (const key of ["portus", "opensky", "aisstream", "itranvias", "tranvias-gtfs"]) {
      expect(byKey.get(key), key).toBeNull();
    }
  });

  it("Open-Meteo: «Open-Meteo.com (datos CAMS)», CC BY 4.0 y nota de uso no comercial", () => {
    const om = SOURCES.find((s) => s.key === "openmeteo-air");
    expect(om?.attribution).toBe("Open-Meteo.com (datos CAMS)");
    expect(om?.license).toMatchObject({
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    });
    expect(om?.note).toBe(true);
  });

  it("las claves de texto usadas existen en los tres idiomas", () => {
    for (const s of SOURCES) {
      const keys = [
        `credits.use.${s.key}`,
        ...(s.note ? [`credits.note.${s.key}`] : []),
      ] as MessageKey[];
      for (const key of keys) {
        for (const messages of Object.values(LOCALES)) expect(messages[key], key).toBeTruthy();
      }
    }
  });
});
