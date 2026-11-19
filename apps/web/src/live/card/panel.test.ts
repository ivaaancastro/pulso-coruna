import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../i18n";
import { T0 } from "../test-helpers";
import {
  cardRows,
  createCardView,
  freshness,
  lazyCardView,
  summarize,
  type CardLayer,
  type CardModel,
} from "./panel";

afterEach(() => {
  document.body.replaceChildren();
});

const t = createTranslator("es");

const model = (layer: CardLayer, over: Partial<CardModel> = {}): CardModel => ({
  layer,
  label: `Detalle ${layer}`,
  kicker: layer.toUpperCase(),
  title: `Título ${layer}`,
  groups: [{ rows: [{ label: "Velocidad", value: "10 kn" }] }],
  ...over,
});

function setup(layer: CardLayer = "ship", extra: { returnFocus?: () => HTMLElement } = {}) {
  const onClose = vi.fn();
  const view = createCardView(document.body, layer, { t, onClose, ...extra });
  return { view, onClose };
}

const panels = () => document.body.querySelectorAll(".pulso-card");
const key = (name: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: name }));

describe("estructura común", () => {
  it("diálogo con nombre accesible, cabecera, filas, notas, frescura y atribución", () => {
    const { view } = setup("sea");
    expect(view.element.hidden).toBe(true);
    view.show(
      model("sea", {
        groups: [
          {
            layout: "stats",
            columns: 2,
            rows: [{ label: "Nivel", value: "3,51 m", size: "lead" }],
          },
        ],
        notes: [{ text: "Respecto al cero del mareógrafo" }],
        updated: { text: "Actualizado hace 2 min", title: "10:02" },
        attribution: { text: "Fuente: Puertos del Estado" },
      }),
    );
    const root = view.element;
    expect(root.hidden).toBe(false);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Detalle sea");
    expect(root.dataset["layer"]).toBe("sea");
    expect(root.querySelector(".pulso-card__kicker")?.textContent).toBe("SEA");
    expect(root.querySelector("h2")?.textContent).toBe("Título sea");
    expect(root.querySelector("dt")?.textContent).toBe("Nivel");
    expect(root.querySelector("dd.pulso-card__lead")?.textContent).toBe("3,51 m");
    expect(root.querySelector(".pulso-card__note")?.textContent).toBe(
      "Respecto al cero del mareógrafo",
    );
    const updated = root.querySelector<HTMLElement>(".pulso-card__updated");
    expect(updated?.textContent).toBe("Actualizado hace 2 min");
    expect(updated?.title).toBe("10:02");
    expect(root.querySelector(".pulso-card__attribution")?.textContent).toBe(
      "Fuente: Puertos del Estado",
    );
    expect(root.querySelector(".pulso-card__close")?.getAttribute("aria-label")).toBe("Cerrar");
  });

  it("las partes opcionales no aparecen y el acento sigue a la capa o al modelo", () => {
    const { view } = setup("bike");
    view.show(model("bike", { groups: [] }));
    const root = view.element;
    expect(root.querySelector<HTMLElement>(".pulso-card__notes")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".pulso-card__updated")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".pulso-card__attribution")?.hidden).toBe(true);
    expect(root.style.getPropertyValue("--card-accent")).toBe("var(--pulso-bike)");
    view.show(model("bike", { accent: "rgb(1 2 3)", icon: { text: "3A" } }));
    expect(root.style.getPropertyValue("--card-accent")).toBe("rgb(1 2 3)");
    expect(root.querySelector(".pulso-card__icon--badge")?.textContent).toBe("3A");
  });

  it("las notas de modelo y estimación llevan su clase (trazo discontinuo, no solo color)", () => {
    const { view } = setup("air");
    view.show(
      model("air", {
        notes: [
          { text: "Modelo", kind: "model" },
          { text: "Estimada", kind: "estimated" },
          { text: "Sin más" },
        ],
      }),
    );
    const classes = [...view.element.querySelectorAll(".pulso-card__note")].map((n) => n.className);
    expect(classes).toEqual([
      "pulso-card__note pulso-card__note--model",
      "pulso-card__note pulso-card__note--estimated",
      "pulso-card__note pulso-card__note--plain",
    ]);
  });

  it("la atribución con enlace abre en pestaña nueva sin referrer", () => {
    const { view } = setup("air");
    view.show(
      model("air", { attribution: { text: "Open-Meteo", href: "https://open-meteo.com/" } }),
    );
    const link = view.element.querySelector<HTMLAnchorElement>(".pulso-card__attribution a");
    expect(link?.textContent).toBe("Open-Meteo");
    expect(link?.rel).toContain("noopener");
    expect(link?.target).toBe("_blank");
  });

  it("solo repinta lo que cambió (se llama en cada fotograma)", () => {
    const { view } = setup();
    view.show(model("ship", { updated: { text: "Actualizado hace 1 min" } }));
    const rows = view.element.querySelector(".pulso-card__rows");
    view.show(model("ship", { updated: { text: "Actualizado hace 2 min" } }));
    expect(view.element.querySelector(".pulso-card__rows")).toBe(rows);
    expect(view.element.querySelector(".pulso-card__updated")?.textContent).toBe(
      "Actualizado hace 2 min",
    );
    view.show(model("ship", { groups: [{ rows: [{ label: "Velocidad", value: "12 kn" }] }] }));
    expect(view.element.querySelector("dd")?.textContent).toBe("12 kn");
  });

  it("el icono se construye solo cuando cambia su clave", () => {
    const { view } = setup("bike");
    const build = vi.fn(() => document.createElement("i"));
    view.show(model("bike", { icon: { key: "a", build } }));
    view.show(model("bike", { icon: { key: "a", build }, title: "Otro" }));
    expect(build).toHaveBeenCalledTimes(1);
    view.show(model("bike", { icon: { key: "b", build } }));
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("resumen: título, filas y notas; nunca la frescura", () => {
    const m = model("plane", {
      notes: [{ text: "Posición estimada hace 3 min" }],
      updated: { text: "Actualizado hace 3 min" },
    });
    expect(cardRows(m)).toEqual([{ label: "Velocidad", value: "10 kn" }]);
    expect(summarize(m)).toBe("Título plane. Velocidad: 10 kn. Posición estimada hace 3 min");
  });

  it("freshness da «Actualizado hace X» y la hora de Madrid", () => {
    const f = freshness(t, T0, T0 + 120_000, "es");
    expect(f.text).toMatch(/^Actualizado hace 2 min/);
    expect(f.title).toMatch(/^\d\d:\d\d$/);
  });
});

describe("un solo panel a la vez", () => {
  it("hay un único elemento aunque varias capas tengan vista", () => {
    const a = setup("bike");
    const b = setup("bus");
    a.view.show(model("bike"));
    b.view.show(model("bus"));
    expect(panels()).toHaveLength(1);
    expect(a.view.element).toBe(b.view.element);
  });

  it("abrir la tarjeta de otra capa cierra la anterior y le avisa una vez", () => {
    const a = setup("bike");
    const b = setup("bus");
    a.view.show(model("bike"));
    expect(a.view.visible).toBe(true);
    b.view.show(model("bus"));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect(b.onClose).not.toHaveBeenCalled();
    expect(a.view.visible).toBe(false);
    expect(b.view.visible).toBe(true);
    expect(b.view.element.querySelector("h2")?.textContent).toBe("Título bus");
    expect(b.view.element.dataset["layer"]).toBe("bus");
  });

  it("si la capa anterior se oculta en su aviso, el panel sigue siendo de la nueva", () => {
    const first = createCardView(document.body, "air", {
      t,
      onClose: () => first.hide(),
    });
    const b = setup("sea");
    first.show(model("air"));
    b.view.show(model("sea"));
    expect(b.view.visible).toBe(true);
    expect(b.view.element.hidden).toBe(false);
  });

  it("mostrar de nuevo la misma capa solo actualiza (no avisa ni cierra)", () => {
    const a = setup("ship");
    a.view.show(model("ship"));
    a.view.show(model("ship", { title: "Otro barco" }));
    expect(a.onClose).not.toHaveBeenCalled();
    expect(a.view.element.querySelector("h2")?.textContent).toBe("Otro barco");
  });

  it("ocultar una capa que no es la actual no toca el panel de otra", () => {
    const a = setup("bike");
    const b = setup("bus");
    b.view.show(model("bus"));
    a.view.hide();
    expect(b.view.visible).toBe(true);
    expect(b.view.element.hidden).toBe(false);
  });

  it("si el anfitrión se vacía, el panel se recrea sin arrastrar el estado anterior", () => {
    const a = setup("bike");
    a.view.show(model("bike"));
    document.body.replaceChildren();
    a.view.show(model("bike", { title: "Nueva" }));
    expect(panels()).toHaveLength(1);
    expect(a.view.element.querySelector("h2")?.textContent).toBe("Nueva");
  });

  it("si el anfitrión se desconecta con el panel abierto, la capa suelta su selección", () => {
    const a = setup("sea");
    a.view.show(model("sea"));
    document.body.replaceChildren();
    setup("bike").view.show(model("bike"));
    expect(a.onClose).toHaveBeenCalledTimes(1);
  });

  it("lazyCardView resuelve #app en cada llamada", () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
    const get = lazyCardView("plane", { t, onClose: vi.fn() });
    get().show(model("plane"));
    expect(app.querySelector(".pulso-card")).not.toBeNull();
    app.remove();
    const other = document.createElement("div");
    other.id = "app";
    document.body.append(other);
    get().show(model("plane"));
    expect(other.querySelector(".pulso-card")).not.toBeNull();
  });
});

describe("cierre y teclado", () => {
  it("el botón cerrar y Esc cierran y avisan una vez; Esc sin panel no hace nada", () => {
    const { view, onClose } = setup();
    view.show(model("ship"));
    view.element.querySelector<HTMLButtonElement>(".pulso-card__close")?.click();
    expect(view.element.hidden).toBe(true);
    expect(view.visible).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    view.show(model("ship"));
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
    view.show(model("ship"));
    key("a");
    expect(view.visible).toBe(true);
  });

  it("hide() es programático: no avisa y deja de escuchar Esc", () => {
    const { view, onClose } = setup();
    view.show(model("ship"));
    view.hide();
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(view.element.hidden).toBe(true);
  });

  it("destroy cierra la vista", () => {
    const { view, onClose } = setup();
    view.show(model("ship"));
    view.destroy();
    expect(view.visible).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("foco", () => {
  it("al abrir el foco va al panel y al cerrar vuelve a quien lo tenía", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { view } = setup();
    view.show(model("ship"));
    expect(document.activeElement).toBe(view.element);
    key("Escape");
    expect(document.activeElement).toBe(opener);
  });

  it("el botón del que lo abrió (returnFocus) gana al elemento activo", () => {
    const chip = document.createElement("button");
    document.body.append(chip);
    const { view } = setup("sea", { returnFocus: () => chip });
    view.show(model("sea"));
    view.element.querySelector<HTMLButtonElement>(".pulso-card__close")?.focus();
    view.element.querySelector<HTMLButtonElement>(".pulso-card__close")?.click();
    expect(document.activeElement).toBe(chip);
  });

  it("actualizar no roba el foco", () => {
    const { view } = setup();
    view.show(model("ship"));
    const close = view.element.querySelector<HTMLButtonElement>(".pulso-card__close");
    close?.focus();
    view.show(model("ship", { title: "Otro" }));
    expect(document.activeElement).toBe(close);
  });

  it("al cambiar de capa el foco pasa al panel, no al botón de la anterior", () => {
    const chip = document.createElement("button");
    document.body.append(chip);
    chip.focus();
    const a = setup("sea", { returnFocus: () => chip });
    const b = setup("bus");
    a.view.show(model("sea"));
    b.view.show(model("bus"));
    expect(document.activeElement).toBe(b.view.element);
  });

  it("un cierre programático con el foco dentro lo devuelve (no lo pierde)", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { view } = setup();
    view.show(model("ship"));
    view.hide();
    expect(document.activeElement).toBe(opener);
  });

  it("sin nadie a quien devolver el foco, cerrar no falla", () => {
    const { view } = setup();
    view.show(model("ship"));
    expect(() => key("Escape")).not.toThrow();
  });
});

describe("aria-live", () => {
  const live = (view: { element: HTMLElement }) =>
    view.element.querySelector('[role="status"]')?.textContent;

  it("anuncia al pedirlo (cambio de elemento) y no con cada actualización", () => {
    const { view } = setup();
    view.show(model("ship"), true);
    expect(live(view)).toBe("Título ship. Velocidad: 10 kn");
    view.show(model("ship", { groups: [{ rows: [{ label: "Velocidad", value: "11 kn" }] }] }));
    expect(live(view)).toBe("Título ship. Velocidad: 10 kn");
    view.show(
      model("ship", { groups: [{ rows: [{ label: "Velocidad", value: "12 kn" }] }] }),
      true,
    );
    expect(live(view)).toBe("Título ship. Velocidad: 12 kn");
  });

  it("la región es educada (status) y se vacía al cerrar", () => {
    const { view } = setup();
    view.show(model("ship"), true);
    const region = view.element.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    view.hide();
    expect(region?.textContent).toBe("");
  });
});
