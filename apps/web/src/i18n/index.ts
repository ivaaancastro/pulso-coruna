import { en } from "./en";
import { es, type MessageKey, type Messages } from "./es";
import { gl } from "./gl";

export type { MessageKey, Messages };
export type Locale = "es" | "gl" | "en";

export const LOCALES = { es, gl, en } as const satisfies Record<Locale, Messages>;
export const DEFAULT_LOCALE: Locale = "es";

/** BCP 47 para Intl (la zona horaria sigue siendo Europe/Madrid). */
export const INTL_LOCALE: Record<Locale, string> = { es: "es-ES", gl: "gl-ES", en: "en-GB" };

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(LOCALES, value);
}

/** Clave de `sessionStorage` con el idioma elegido en el selector (solo dura la sesión de la pestaña). */
export const SESSION_KEY = "pulso.lang";

/** Lee el idioma de la sesión; sin almacenamiento (modo privado, bloqueado) devuelve `null`. */
export function readSessionLocale(
  getStorage: () => Pick<Storage, "getItem"> | undefined,
): string | null {
  try {
    return getStorage()?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Prioridad: `?lang=`, idioma elegido en esta sesión, idiomas del navegador y, por último, es. */
export function detectLocale(
  search: string,
  languages: readonly string[],
  stored: string | null = null,
): Locale {
  const asked = new URLSearchParams(search).get("lang");
  if (asked && isLocale(asked)) return asked;
  if (stored && isLocale(stored)) return stored;
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (key: MessageKey, params?: Record<string, string>) => string;

export function createTranslator(locale: Locale): Translate {
  const messages = LOCALES[locale];
  return (key, params) => {
    let text: string = messages[key];
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, value);
      }
    }
    return text;
  };
}
