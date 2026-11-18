import { describe, expect, it } from "vitest";
import { createTranslator, detectLocale, LOCALES, type Locale } from "./index";

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
    expect(t("mode.unavailable", { mode: "Escuchar" })).toBe(
      "Escuchar estará disponible próximamente.",
    );
  });

  it("detecta idioma: parámetro, navegador y valor por defecto", () => {
    expect(detectLocale("?lang=gl", ["en-US"])).toBe("gl");
    expect(detectLocale("", ["fr-FR", "en-US"])).toBe("en");
    expect(detectLocale("", ["gl-ES"])).toBe("gl");
    expect(detectLocale("?lang=xx", ["fr"])).toBe("es");
    expect(detectLocale("", [])).toBe("es");
  });
});
