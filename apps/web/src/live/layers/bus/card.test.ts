import type { Entity } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { createTranslator, LOCALES, type Locale } from "../../../i18n";
import { cardRows, summarize } from "../../card/panel";
import { formatBusCard } from "./card";
import { BUS_META, busInfo } from "./meta";

const bus = (meta?: Entity["meta"]): Entity => ({
  id: "b1",
  layer: "bus",
  lon: -8.4,
  lat: 43.37,
  ts: 1_760_000_000_000,
  meta,
});

describe("busInfo", () => {
  it("lee línea, destino, próxima parada y la marca de estimación", () => {
    const info = busInfo(
      bus({ line: "3A", headsign: "Matogrande", nextStop: "Plaza de Pontevedra", estimated: 1 }),
    );
    expect(info).toEqual({
      id: "b1",
      line: "3A",
      headsign: "Matogrande",
      nextStop: "Plaza de Pontevedra",
      estimated: true,
    });
  });

  it("sin marca es posición real; tolera metadatos ausentes, vacíos o numéricos", () => {
    expect(busInfo(bus()).estimated).toBe(false);
    expect(busInfo(bus({ estimated: 0 })).estimated).toBe(false);
    expect(busInfo(bus({ estimated: "1" })).estimated).toBe(true);
    const info = busInfo(bus({ line: 12, headsign: "  " }));
    expect(info.line).toBe("12");
    expect(info.headsign).toBeUndefined();
  });

  it("las claves de meta están en una sola constante", () => {
    expect(Object.keys(BUS_META).sort()).toEqual(["estimated", "headsign", "line", "nextStop"]);
  });
});

describe("formatBusCard", () => {
  const es = createTranslator("es");

  it("muestra línea, destino y próxima parada", () => {
    const card = formatBusCard(
      busInfo(bus({ line: "3A", headsign: "Matogrande", nextStop: "Riazor" })),
      es,
    );
    expect(card.title).toBe("Línea 3A");
    expect(cardRows(card)).toEqual([
      { label: "Destino", value: "Matogrande" },
      { label: "Próxima parada", value: "Riazor" },
    ]);
    expect(card.notes).toEqual([]);
    expect(card.icon?.text).toBe("3A");
    expect(summarize(card)).toContain("Línea 3A");
  });

  it("rotula «estimado según horario» siempre que la marca esté presente", () => {
    const card = formatBusCard(busInfo(bus({ line: "3A", estimated: 1 })), es);
    expect(card.notes).toEqual([{ text: "Estimado según horario", kind: "estimated" }]);
    expect(summarize(card)).toContain("Estimado según horario");
  });

  it("omite las filas que faltan y titula «Autobús» sin línea", () => {
    const card = formatBusCard(busInfo(bus()), es);
    expect(card.title).toBe("Autobús");
    expect(cardRows(card)).toEqual([]);
    expect(card.icon).toBeUndefined();
  });

  it("el acento de la línea llega como color CSS", () => {
    const card = formatBusCard(busInfo(bus({ line: "3A" })), es, [255, 194, 61]);
    expect(card.accent).toBe("rgb(255 194 61)");
  });

  it("está traducido a es, en y gl", () => {
    const info = busInfo(bus({ line: "5", headsign: "X", nextStop: "Y", estimated: 1 }));
    const notes = (["es", "en", "gl"] as Locale[]).map(
      (l) => formatBusCard(info, createTranslator(l)).notes?.[0]?.text,
    );
    expect(new Set(notes).size).toBe(3);
    for (const l of Object.keys(LOCALES) as Locale[]) {
      expect(createTranslator(l)("bus.card.title", { line: "5" })).toContain("5");
    }
  });
});
