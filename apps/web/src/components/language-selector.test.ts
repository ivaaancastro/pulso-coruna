import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, SESSION_KEY } from "../i18n";
import { createLanguageSelector, withLang } from "./language-selector";

function setup(locale: "gl" | "es" | "en" = "es", href = "https://pulso.test/?x=1#c=2,3") {
  const navigate = vi.fn();
  const storage = { setItem: vi.fn() };
  const root = createLanguageSelector({
    t: createTranslator(locale),
    locale,
    navigate,
    location: { href },
    storage,
  });
  document.body.replaceChildren(root);
  const toggle = root.querySelector<HTMLButtonElement>(".lang__toggle");
  const menu = root.querySelector<HTMLElement>(".lang__menu");
  if (!toggle || !menu) throw new Error("selector sin botón o menú");
  const options = [...root.querySelectorAll<HTMLButtonElement>(".lang__option")];
  return { root, toggle, menu, options, navigate, storage };
}

describe("selector de idioma", () => {
  beforeEach(() => document.body.replaceChildren());

  it("el botón muestra el idioma actual y su nombre accesible lo dice completo", () => {
    const gl = setup("gl");
    expect(gl.toggle.textContent).toBe("GL");
    expect(gl.toggle.getAttribute("aria-label")).toBe("Idioma: Galego");
    expect(gl.toggle.getAttribute("aria-expanded")).toBe("false");
    expect(gl.menu.hidden).toBe(true);
    const en = setup("en");
    expect(en.toggle.getAttribute("aria-label")).toBe("Language: English");
    expect(en.menu.getAttribute("aria-label")).toBe("Language");
  });

  it("el menú lista gallego, castellano e inglés, cada uno en su idioma, con aria-pressed", () => {
    const { toggle, menu, options } = setup("gl");
    toggle.click();
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(menu.getAttribute("role")).toBe("group");
    expect(options.map((o) => o.textContent)).toEqual(["Galego", "Castellano", "English"]);
    expect(options.map((o) => o.lang)).toEqual(["gl", "es", "en"]);
    expect(options.map((o) => o.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
  });

  it("al abrir, el foco va a la opción activa; Escape cierra y devuelve el foco al botón", () => {
    const { toggle, menu, options } = setup("es");
    toggle.click();
    expect(document.activeElement).toBe(options[1]);
    options[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("un clic fuera cierra el menú", () => {
    const { toggle, menu } = setup();
    toggle.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it("elegir otro idioma lo guarda en la sesión y recarga con ?lang= sin perder parámetros ni hash", () => {
    const { toggle, options, navigate, storage } = setup("es");
    toggle.click();
    options[0]?.click();
    expect(storage.setItem).toHaveBeenCalledWith(SESSION_KEY, "gl");
    expect(navigate).toHaveBeenCalledWith("https://pulso.test/?x=1&lang=gl#c=2,3");
  });

  it("elegir el idioma activo solo cierra el menú", () => {
    const { toggle, menu, options, navigate } = setup("es");
    toggle.click();
    options[1]?.click();
    expect(navigate).not.toHaveBeenCalled();
    expect(menu.hidden).toBe(true);
  });

  it("sin almacenamiento sigue funcionando con ?lang=", () => {
    const navigate = vi.fn();
    const root = createLanguageSelector({
      t: createTranslator("es"),
      locale: "es",
      navigate,
      location: { href: "https://pulso.test/" },
      storage: {
        setItem: () => {
          throw new Error("bloqueado");
        },
      },
    });
    root.querySelector<HTMLButtonElement>("button[lang=en]")?.click();
    expect(navigate).toHaveBeenCalledWith("https://pulso.test/?lang=en");
  });

  it("son botones nativos (teclado: Tab, Intro, Espacio)", () => {
    const { toggle, options } = setup();
    for (const b of [toggle, ...options]) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.type).toBe("button");
    }
  });

  it("withLang sustituye un ?lang= previo", () => {
    expect(withLang("https://pulso.test/?lang=es&a=b", "gl")).toBe(
      "https://pulso.test/?lang=gl&a=b",
    );
  });
});
