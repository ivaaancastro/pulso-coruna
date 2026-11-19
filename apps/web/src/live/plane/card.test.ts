import type { Entity } from "@pulso/schema";
import { describe, expect, it } from "vitest";
import { cardRows, summarize } from "../card/panel";
import { INTL_LOCALE, LOCALES, createTranslator } from "../../i18n";
import { formatPlaneCard, metersToFeet, msToKmh, msToKnots } from "./card";
import { estimate } from "./extrapolate";
import { planeInfo } from "./meta";

const T0 = 1_760_000_000_000;
const entity = (over: Partial<Entity> = {}): Entity => ({
  id: "34324a",
  layer: "plane",
  lon: -8.4,
  lat: 43.35,
  ts: T0,
  heading: 273.4,
  speed: 125,
  meta: { source: "opensky", callsign: "IBE1234 ", alt: 3050, onGround: 0, vrate: -5 },
  ...over,
});

const content = (e: Entity, now: number, locale: "es" | "en" | "gl" = "es") => {
  const info = planeInfo(e);
  return formatPlaneCard(
    info,
    estimate(info, now),
    now,
    createTranslator(locale),
    INTL_LOCALE[locale],
  );
};

describe("planeInfo", () => {
  it("lee meta y limpia el indicativo", () => {
    const i = planeInfo(entity());
    expect(i).toMatchObject({ callsign: "IBE1234", altM: 3050, onGround: false, vrate: -5 });
    expect(planeInfo(entity({ meta: { callsign: "  " } })).callsign).toBeUndefined();
    expect(planeInfo(entity({ meta: { onGround: 1 } })).onGround).toBe(true);
    expect(planeInfo(entity({ heading: -90 })).heading).toBe(270);
  });
});

describe("formatPlaneCard", () => {
  it("convierte unidades", () => {
    expect(metersToFeet(3050)).toBeCloseTo(10006.6, 1);
    expect(msToKmh(125)).toBe(450);
    expect(msToKnots(125)).toBeCloseTo(243, 0);
  });

  it("indicativo, altitud m/ft, velocidad km/h/kn, rumbo, posición estimada y atribución", () => {
    const c = content(entity(), T0 + 3 * 60_000);
    expect(c.title).toBe("IBE1234");
    const rows = Object.fromEntries(cardRows(c).map((r) => [r.label, r.value]));
    expect(rows.Altitud).toMatch(/3\.?050 m · 10\.?007 ft/);
    expect(rows.Velocidad).toBe("450 km/h · 243 kn");
    expect(rows.Rumbo).toBe("273°");
    expect(c.notes).toEqual([{ text: "Posición estimada hace 3 min", kind: "estimated" }]);
    expect(c.attribution?.text).toBe("Fuente: OpenSky Network");
    expect(summarize(c)).toContain("IBE1234");
  });

  it("sin indicativo y en tierra: «posición registrada», no estimada", () => {
    const c = content(entity({ speed: 0, meta: { onGround: 1 } }), T0 + 60_000);
    expect(c.title).toBe("Sin indicativo");
    expect(cardRows(c)[0]?.value).toBe("En tierra");
    expect(c.notes).toEqual([{ text: "Posición registrada hace 1 min", kind: "plain" }]);
  });

  it("omite filas sin dato y habla los tres idiomas", () => {
    const sparse = content(entity({ heading: undefined, speed: undefined, meta: {} }), T0);
    expect(cardRows(sparse)).toEqual([]);
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const c = content(entity(), T0 + 120_000, locale);
      expect(c.title).toBe("IBE1234");
      expect(c.attribution?.text).toContain("OpenSky Network");
      expect(c.notes?.[0]?.text).not.toContain("plane.card");
    }
    expect(content(entity(), T0 + 120_000, "gl").attribution?.text).toBe("Fonte: OpenSky Network");
    expect(content(entity(), T0 + 120_000, "en").attribution?.text).toBe("Source: OpenSky Network");
  });
});
