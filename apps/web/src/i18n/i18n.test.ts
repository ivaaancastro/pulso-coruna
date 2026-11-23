import { describe, expect, it } from "vitest";
import { createTranslator, detectLocale, LOCALES, readSessionLocale, type Locale } from "./index";

const locales = Object.keys(LOCALES) as Locale[];

describe("i18n", () => {
  it("todos los idiomas tienen exactamente las mismas claves que es", () => {
    const reference = Object.keys(LOCALES.es).sort();
    for (const locale of locales) {
      expect(Object.keys(LOCALES[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("ninguna cadena está vacía y los marcadores {x} coinciden con es", () => {
    const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const locale of locales) {
      for (const [key, value] of Object.entries(LOCALES[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
        const base = LOCALES.es[key as keyof typeof LOCALES.es];
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(base));
      }
    }
  });

  it("sustituye parámetros", () => {
    const t = createTranslator("es");
    expect(t("mode.selected", { mode: "Escuchar" })).toBe("Modo Escuchar activo.");
  });

  it("detecta idioma: parámetro, navegador y valor por defecto", () => {
    expect(detectLocale("?lang=gl", ["en-US"])).toBe("gl");
    expect(detectLocale("", ["fr-FR", "en-US"])).toBe("en");
    expect(detectLocale("", ["gl-ES"])).toBe("gl");
    expect(detectLocale("?lang=xx", ["fr"])).toBe("es");
    expect(detectLocale("", [])).toBe("es");
  });

  it("el idioma de la sesión va tras ?lang= y antes del navegador", () => {
    expect(detectLocale("", ["en-US"], "gl")).toBe("gl");
    expect(detectLocale("?lang=en", ["es"], "gl")).toBe("en");
    expect(detectLocale("", ["en-US"], "xx")).toBe("en");
    expect(detectLocale("", ["en-US"], null)).toBe("en");
  });

  it("lee el idioma de sesión sin romper si el almacenamiento falla", () => {
    expect(readSessionLocale(() => ({ getItem: () => "gl" }))).toBe("gl");
    expect(readSessionLocale(() => undefined)).toBeNull();
    expect(
      readSessionLocale(() => ({
        getItem: () => {
          throw new Error("bloqueado");
        },
      })),
    ).toBeNull();
    expect(
      readSessionLocale(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
  });

  it("los nombres de idioma (autónimos) son iguales en todos los catálogos", () => {
    for (const key of ["lang.gl", "lang.es", "lang.en"] as const) {
      expect(new Set(locales.map((l) => LOCALES[l][key])).size, key).toBe(1);
    }
  });

  it("en no reutiliza por descuido texto castellano (solo nombres propios, símbolos y «Bus»)", () => {
    const same = Object.entries(LOCALES.en)
      .filter(([key, value]) => value === LOCALES.es[key as keyof typeof LOCALES.es])
      .map(([key]) => key);
    expect(same).toEqual([
      "app.name",
      "lang.gl",
      "lang.es",
      "lang.en",
      "bike.name",
      "ship.card.knots",
      "plane.card.altitude.value",
      "plane.card.speed.value",
      "plane.card.heading.value",
      "status.layer.bus",
      "status.layer.bike",
      "clip.credit",
    ]);
  });
});
