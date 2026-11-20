import { SESSION_KEY, type Locale, type MessageKey, type Translate } from "../i18n";

const LABEL_KEY: Record<Locale, MessageKey> = {
  gl: "lang.gl",
  es: "lang.es",
  en: "lang.en",
};

/** Orden visible: gallego, castellano, inglés. */
const ORDER: readonly Locale[] = ["gl", "es", "en"];

export interface LanguageSelectorOptions {
  t: Translate;
  locale: Locale;
  /** Recarga con otro idioma; inyectable para probar (por defecto, `location.assign`). */
  navigate?: (url: string) => void;
  location?: Pick<Location, "href">;
  storage?: Pick<Storage, "setItem">;
}

/** URL actual con `?lang=` cambiado; conserva el resto de parámetros y el hash (cámara, modo). */
export function withLang(href: string, locale: Locale): string {
  const url = new URL(href);
  url.searchParams.set("lang", locale);
  return url.toString();
}

/**
 * Selector de idioma (M8.1): un botón con el idioma actual (GL/ES/EN) que despliega tres opciones
 * (`aria-pressed`). Elegir una lo guarda solo para la sesión y recarga con `?lang=`: los textos se
 * fijan al montar la interfaz. Escape o un clic fuera lo cierran y devuelven el foco al botón.
 */
export function createLanguageSelector(opts: LanguageSelectorOptions): HTMLElement {
  const root = document.createElement("div");
  root.className = "lang";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lang__toggle";
  toggle.textContent = opts.locale.toUpperCase();
  toggle.setAttribute(
    "aria-label",
    opts.t("lang.current", { language: opts.t(LABEL_KEY[opts.locale]) }),
  );
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "lang__menu";
  menu.hidden = true;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", opts.t("lang.label"));

  const setOpen = (open: boolean, restoreFocus = false): void => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
    else if (restoreFocus) toggle.focus();
  };

  for (const code of ORDER) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "lang__option";
    option.lang = code;
    option.textContent = opts.t(LABEL_KEY[code]);
    option.setAttribute("aria-pressed", String(code === opts.locale));
    option.addEventListener("click", () => {
      if (code === opts.locale) {
        setOpen(false, true);
        return;
      }
      try {
        (opts.storage ?? window.sessionStorage).setItem(SESSION_KEY, code);
      } catch {
        // Sin almacenamiento: basta con `?lang=`.
      }
      const target = withLang((opts.location ?? window.location).href, code);
      (opts.navigate ?? ((url: string) => window.location.assign(url)))(target);
    });
    menu.append(option);
  }

  toggle.addEventListener("click", () => setOpen(menu.hidden));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.stopPropagation();
      setOpen(false, true);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !root.contains(event.target as Node)) setOpen(false);
  });
  // Al salir con Tab del menú se cierra (sin robar el foco).
  root.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as Node | null;
    if (!menu.hidden && next && !root.contains(next)) setOpen(false);
  });

  root.append(toggle, menu);
  return root;
}
