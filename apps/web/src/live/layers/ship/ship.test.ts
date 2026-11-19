import type { Entity } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { createTranslator, LOCALES, type Locale } from "../../../i18n";
import { T0 } from "../../test-helpers";
import { TrailHistory } from "../bus/trails";
import { formatShipCard } from "./card";
import { shipInfo, shipKind } from "./meta";
import {
  fadeFactor,
  FADE_START_MS,
  isMoored,
  KNOT_MS,
  SIZE_PX,
  sizeClass,
  STALE_MS,
  styleShips,
} from "./model";
import { SHIP_TRAIL_PRESETS, shipTrailConfig } from "./trail";

const ship = (id: string, over: Partial<Entity> = {}): Entity => ({
  id,
  layer: "ship",
  lon: -8.39,
  lat: 43.37,
  ts: T0,
  ...over,
});

describe("shipKind (tipo AIS)", () => {
  it.each([
    [70, "cargo"],
    [79, "cargo"],
    [80, "tanker"],
    [89, "tanker"],
    [60, "passenger"],
    [45, "passenger"],
    [30, "fishing"],
    [31, "tug"],
    [52, "tug"],
    [36, "pleasure"],
    [37, "pleasure"],
    [50, "service"],
    [35, "service"],
    [99, "other"],
    [0, "other"],
    [undefined, "other"],
  ] as const)("%s → %s", (type, kind) => {
    expect(shipKind(type)).toBe(kind);
  });

  it("hay 4 clases de tamaño, de mayor a menor, y las tablas cubren todos los tipos", () => {
    expect(sizeClass("cargo")).toBe("large");
    expect(sizeClass("passenger")).toBe("medium");
    expect(sizeClass("fishing")).toBe("small");
    expect(sizeClass("pleasure")).toBe("tiny");
    expect(sizeClass("other")).toBe("tiny");
    expect(new Set(Object.values(SIZE_PX)).size).toBe(4);
    expect(SIZE_PX.large).toBeGreaterThan(SIZE_PX.medium);
    expect(SIZE_PX.medium).toBeGreaterThan(SIZE_PX.small);
    expect(SIZE_PX.small).toBeGreaterThan(SIZE_PX.tiny);
  });
});

describe("shipInfo (privacidad)", () => {
  it("lee nombre, tipo, velocidad y rumbo, y sanea el nombre AIS", () => {
    const info = shipInfo(
      ship("x", {
        speed: 3,
        heading: 120,
        meta: { name: "  MOCK@@ CARGO  ", shipType: 71, navStatus: 0 },
      }),
    );
    expect(info).toMatchObject({ kind: "cargo", name: "MOCK CARGO", speed: 3, heading: 120 });
  });

  it("no expone el nombre de las embarcaciones de recreo (36 y 37)", () => {
    for (const shipType of [36, 37]) {
      const info = shipInfo(ship("x", { meta: { name: "MARIA DEL CARMEN", shipType } }));
      expect(info.kind).toBe("pleasure");
      expect(info.name).toBeUndefined();
    }
  });

  it("recorta nombres larguísimos y tolera meta ausente o tipo en texto", () => {
    expect(shipInfo(ship("x", { meta: { name: "A".repeat(80), shipType: "70" } }))).toMatchObject({
      kind: "cargo",
    });
    expect(shipInfo(ship("x", { meta: { name: "A".repeat(80) } })).name).toHaveLength(40);
    expect(shipInfo(ship("x"))).toMatchObject({ kind: "other", name: undefined });
  });
});

describe("modelo de estilo", () => {
  it("parado: bajo 0,5 kn, o fondeado/amarrado sin velocidad", () => {
    expect(isMoored(0, undefined)).toBe(true);
    expect(isMoored(0.2, 0)).toBe(true);
    expect(isMoored(0.5 * KNOT_MS + 0.01, undefined)).toBe(false);
    expect(isMoored(undefined, 5)).toBe(true);
    expect(isMoored(undefined, 1)).toBe(true);
    expect(isMoored(undefined, 0)).toBe(false);
    expect(isMoored(undefined, undefined)).toBe(false);
    // Con velocidad, manda la velocidad (un amarrado que se mueve no está parado).
    expect(isMoored(4, 5)).toBe(false);
  });

  it("se desvanece de 6 a 10 min y desaparece a los 10", () => {
    expect(fadeFactor(0)).toBe(1);
    expect(fadeFactor(FADE_START_MS)).toBe(1);
    expect(fadeFactor((FADE_START_MS + STALE_MS) / 2)).toBeCloseTo(0.5);
    expect(fadeFactor(STALE_MS)).toBe(0);
    expect(fadeFactor(STALE_MS * 3)).toBe(0);
  });

  it("estilo por barco: tamaño por tipo, parados discretos, estela solo en marcha", () => {
    const entities = new Map<string, Entity>([
      ["cargo", ship("cargo", { speed: 5, meta: { shipType: 70 } })],
      ["moored", ship("moored", { speed: 0, meta: { shipType: 70 } })],
      ["boat", ship("boat", { speed: 2, meta: { shipType: 37 } })],
      ["old", ship("old", { speed: 5, ts: T0 - STALE_MS - 1, meta: { shipType: 70 } })],
      ["fading", ship("fading", { speed: 5, ts: T0 - 8 * 60_000, meta: { shipType: 70 } })],
    ]);
    const ids = [...entities.keys(), "unknown"];
    const style = styleShips(
      { count: ids.length, ids, headings: [90, 0, 0, 0, 0, 0] },
      (id) => entities.get(id),
      T0,
    );
    const alpha = (i: number): number => style.colors[4 * i + 3] as number;
    expect(style.sizes[0]).toBe(SIZE_PX.large);
    expect(style.sizes[1]).toBeLessThan(SIZE_PX.large); // parado: más pequeño
    expect(alpha(1)).toBeLessThan(alpha(0)); // y más tenue
    expect(style.sizes[2]).toBe(SIZE_PX.tiny);
    expect([style.trail[0], style.trail[1], style.trail[2]]).toEqual([1, 0, 1]);
    expect(style.angles[0]).toBe(-90);
    // Vencido o sin dato: no se dibuja ni se toca.
    for (const i of [3, 5]) {
      expect(style.sizes[i]).toBe(0);
      expect(style.hits[i]).toBe(0);
    }
    // Desvaneciéndose: visible, más tenue, sin estela.
    expect(style.sizes[4]).toBeGreaterThan(0);
    expect(alpha(4)).toBeLessThan(alpha(0));
    expect(alpha(4)).toBeGreaterThan(0);
    expect(style.trail[4]).toBe(0);
    expect(style.visible).toBe(4);
  });

  it("el color sale del token --pulso-ship (#FF7A59)", () => {
    const style = styleShips(
      { count: 1, ids: ["a"], headings: [0] },
      () => ship("a", { speed: 3 }),
      T0,
    );
    expect([...style.colors.slice(0, 3)]).toEqual([0xff, 0x7a, 0x59]);
  });

  it("una hora forzada anterior al dato no da edades negativas", () => {
    const style = styleShips(
      { count: 1, ids: ["a"], headings: [0] },
      () => ship("a", { speed: 3, ts: T0 + 3_600_000 }),
      T0,
    );
    expect(style.colors[3]).toBe(255);
  });
});

describe("tarjeta", () => {
  const t = (locale: Locale) => createTranslator(locale);

  it("nombre, tipo, nudos, rumbo, antigüedad y atribución; ningún identificador", () => {
    const e = ship("abc123def456", {
      speed: 5.14444,
      heading: 123.4,
      ts: T0 - 120_000,
      meta: { name: "MOCK CARGO", shipType: 70 },
    });
    const card = formatShipCard(shipInfo(e), t("es"), "es", T0);
    expect(card.title).toBe("MOCK CARGO");
    expect(card.rows).toEqual([
      { label: "Tipo", value: "Carguero" },
      { label: "Velocidad", value: "10 kn" },
      { label: "Rumbo", value: "123°" },
    ]);
    expect(card.updated).toMatch(/^Actualizado hace 2 min/);
    expect(card.source).toBe("Fuente: aisstream.io");
    const all = JSON.stringify(card);
    expect(all).not.toContain("abc123def456");
  });

  it("recreo: título genérico, sin nombre en ninguna parte", () => {
    const e = ship("x", {
      speed: 2,
      meta: { name: "ANA MARIA", shipType: 37 },
    });
    const card = formatShipCard(shipInfo(e), t("es"), "es", T0);
    expect(card.title).toBe("Embarcación de recreo");
    expect(JSON.stringify(card)).not.toContain("ANA MARIA");
    expect(card.rows.some((r) => r.label === "Tipo")).toBe(false);
  });

  it("parado dice «Parado»; sin velocidad ni rumbo no hay filas vacías", () => {
    const stopped = formatShipCard(shipInfo(ship("x", { speed: 0 })), t("es"), "es", T0);
    expect(stopped.rows).toEqual([{ label: "Velocidad", value: "Parado" }]);
    expect(formatShipCard(shipInfo(ship("x")), t("es"), "es", T0).rows).toEqual([]);
  });

  it("es/en/gl: tipos, atribución y decimales según el idioma", () => {
    const e = ship("x", { speed: 3, meta: { name: "X", shipType: 80 } });
    expect(formatShipCard(shipInfo(e), t("en"), "en", T0).rows[0]?.value).toBe("Tanker");
    expect(formatShipCard(shipInfo(e), t("gl"), "gl", T0).rows[0]?.value).toBe("Petroleiro");
    expect(formatShipCard(shipInfo(e), t("gl"), "gl", T0).source).toBe("Fonte: aisstream.io");
    expect(formatShipCard(shipInfo(e), t("en"), "en", T0).source).toBe("Source: aisstream.io");
    expect(formatShipCard(shipInfo(e), t("en"), "en", T0).rows[1]?.value).toBe("5.8 kn");
    expect(formatShipCard(shipInfo(e), t("es"), "es", T0).rows[1]?.value).toBe("5,8 kn");
  });

  it("todas las claves de la tarjeta existen en los tres idiomas", () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const keys = Object.keys(LOCALES[locale]).filter((k) => k.startsWith("ship."));
      expect(keys.length, locale).toBeGreaterThanOrEqual(17);
    }
  });
});

describe("estela de barcos", () => {
  it("calidad alta > media > baja, y en baja no hay estela", () => {
    const { high, medium, low } = SHIP_TRAIL_PRESETS;
    expect(high.lengthMs).toBeGreaterThan(medium.lengthMs);
    expect(low.lengthMs).toBe(0);
    shipTrailConfig.setQuality("medium");
    expect(shipTrailConfig.settings).toEqual(medium);
    shipTrailConfig.setQuality("high");
  });

  it("TrailHistory.build respeta el filtro `include` (los parados no dejan estela)", () => {
    const h = new TrailHistory();
    const settings = SHIP_TRAIL_PRESETS.high;
    const ids = ["a", "b"];
    for (let k = 0; k < 5; k++) {
      const now = T0 + k * 2000;
      const pos = [-8.39 + k * 0.0001, 43.37, -8.38 + k * 0.0001, 43.37];
      h.record(now, ids, pos, 2, settings);
    }
    const now = T0 + 8000;
    const pos = [-8.3895, 43.37, -8.3795, 43.37];
    const all = h.build(now, ids, pos, 2, settings.lengthMs, () => [1, 2, 3]);
    const only = h.build(
      now,
      ids,
      pos,
      2,
      settings.lengthMs,
      () => [1, 2, 3],
      (i) => i === 0,
    );
    expect(all.length).toBe(2);
    expect(only.length).toBe(1);
  });
});
