import { INTL_LOCALE, type Locale, type Translate } from "../../i18n";
import { formatAgo, formatMadridTime } from "../../time/format";
import "./card.css";

/**
 * Panel de detalle común (M5.3). Cada capa con tarjeta aporta solo un `CardModel` (título, filas,
 * nota, atribución); la estructura, el CSS, el foco, `Esc` y la regla «un solo panel a la vez» viven
 * aquí. Hay un único elemento DOM por anfitrión (`#app`): abrir la tarjeta de otra capa cierra la
 * anterior (le avisa con `onClose` para que suelte su selección).
 */

export type CardLayer = "bike" | "bus" | "sea" | "ship" | "air" | "plane";

export interface CardRow {
  label: string;
  value: string;
  /** `lead`: cifra grande en el color de la capa. */
  size?: "lead";
  /** Adorno tras el valor (p. ej. la escala del aire). Va por función: no entra en la comparación. */
  extra?: () => Node;
}

export interface CardGroup {
  heading?: string;
  rows: readonly CardRow[];
  /** `list`: etiqueta | valor en dos columnas. `stats`: etiqueta sobre valor en `columns` columnas. */
  layout?: "list" | "stats";
  columns?: 1 | 2 | 3;
}

export interface CardNote {
  text: string;
  /** `model`/`estimated`: dato que no es una medición (el trazo discontinuo no depende del color). */
  kind?: "plain" | "state" | "model" | "estimated";
}

export interface CardModel {
  layer: CardLayer;
  /** Nombre accesible del diálogo. */
  label: string;
  /** Nombre de la capa, sobre el título. */
  kicker: string;
  title: string;
  /** Color de acento (CSS); por defecto el de la capa. */
  accent?: string;
  /** Icono de cabecera: texto (distintivo) o nodo; `key` lo vuelve a dibujar cuando cambia. */
  icon?: { text?: string; key?: string; build?: () => Node };
  groups: readonly CardGroup[];
  notes?: readonly CardNote[];
  /** Frescura: «Actualizado hace X» y la hora de Madrid en `title`. */
  updated?: { text: string; title?: string };
  /** Pie de atribución. */
  attribution?: { text: string; href?: string };
}

export interface CardHooks {
  t: Translate;
  /** El usuario cerró el panel (× o Esc) o la tarjeta de otra capa lo tomó: soltar la selección. */
  onClose: () => void;
  /** A quién devolver el foco al cerrar (por defecto, quien lo tenía al abrir). */
  returnFocus?: () => HTMLElement | null | undefined;
}

export interface CardView {
  /** Abre (o actualiza) el panel con este modelo. `announce`: leerlo a los lectores de pantalla. */
  show(model: CardModel, announce?: boolean): void;
  /** Cierra el panel si es el de esta capa (sin avisar con `onClose`). */
  hide(): void;
  readonly visible: boolean;
  /** El panel compartido. */
  readonly element: HTMLElement;
  destroy(): void;
}

/** «Actualizado hace X» y la hora de Madrid para `title`. */
export function freshness(
  t: Translate,
  ts: number,
  now: number,
  locale: Locale,
): NonNullable<CardModel["updated"]> {
  const intl = INTL_LOCALE[locale];
  return {
    text: t("card.updated", { ago: formatAgo(ts, now, intl) }),
    title: formatMadridTime(ts, intl),
  };
}

/** Todas las filas del modelo, en orden. */
export function cardRows(model: CardModel): CardRow[] {
  return model.groups.flatMap((g) => [...g.rows]);
}

/** Resumen para lectores de pantalla: cambia con el dato, no con el reloj. */
export function summarize(model: CardModel): string {
  return [
    model.title,
    ...cardRows(model).map((r) => `${r.label}: ${r.value}`),
    ...(model.notes ?? []).map((n) => n.text),
  ].join(". ");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Slot {
  owner: CardLayer;
  hooks: CardHooks;
  opener: HTMLElement | null;
}

interface Panel {
  readonly root: HTMLElement;
  show(slot: Slot, model: CardModel, announce: boolean): void;
  release(slot: Slot, userClosed: boolean): void;
  isCurrent(slot: Slot): boolean;
  destroy(): void;
}

/** Para `aria-controls` de los botones que abren el panel. */
export const PANEL_ID = "pulso-card";

const panels = new WeakMap<HTMLElement, Panel>();

function panelFor(host: HTMLElement): Panel {
  const existing = panels.get(host);
  if (existing?.root.isConnected) return existing;
  existing?.destroy();
  const panel = createPanel(host);
  panels.set(host, panel);
  return panel;
}

function createPanel(host: HTMLElement): Panel {
  const root = el("section", "pulso-card");
  root.hidden = true;
  root.id = PANEL_ID;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");

  const head = el("header", "pulso-card__head");
  const icon = el("span", "pulso-card__icon");
  icon.setAttribute("aria-hidden", "true");
  const titles = el("div", "pulso-card__titles");
  const kicker = el("p", "pulso-card__kicker");
  const title = el("h2", "pulso-card__title");
  titles.append(kicker, title);
  const close = el("button", "pulso-card__close", "×");
  close.type = "button";
  head.append(icon, titles, close);

  const body = el("div", "pulso-card__body");
  const notes = el("div", "pulso-card__notes");
  const updated = el("p", "pulso-card__updated");
  const attribution = el("p", "pulso-card__attribution");
  // Cortés (`polite`): solo se escribe al abrir o al cambiar de estado, nunca con el reloj.
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.append(head, body, notes, updated, attribution, live);
  host.append(root);

  let current: Slot | null = null;
  /** Última versión pintada de cada parte: solo se toca el DOM de lo que cambió. */
  let done: Record<string, string> = {};
  const part = (name: string, value: unknown, paint: () => void): void => {
    const key = JSON.stringify(value) ?? "";
    if (done[name] === key) return;
    done[name] = key;
    paint();
  };

  function paintGroups(groups: readonly CardGroup[]): void {
    body.replaceChildren(
      ...groups.map((g) => {
        const group = el("div", "pulso-card__group");
        if (g.heading) group.append(el("p", "pulso-card__heading", g.heading));
        const stats = g.layout === "stats";
        const list = el("dl", `pulso-card__rows pulso-card__rows--${stats ? "stats" : "list"}`);
        list.style.setProperty("--card-cols", String(g.columns ?? 1));
        for (const r of g.rows) {
          const row = el("div", "pulso-card__row");
          const dd = el("dd", r.size === "lead" ? "pulso-card__lead" : undefined, r.value);
          if (r.extra) dd.append(r.extra());
          row.append(el("dt", undefined, r.label), dd);
          list.append(row);
        }
        group.append(list);
        return group;
      }),
    );
  }

  function paint(model: CardModel): void {
    root.dataset.layer = model.layer;
    root.style.setProperty("--card-accent", model.accent ?? `var(--pulso-${model.layer})`);
    root.setAttribute("aria-label", model.label);
    part("icon", [model.icon?.text, model.icon?.key, model.layer], () => {
      icon.className = `pulso-card__icon${model.icon?.text !== undefined ? " pulso-card__icon--badge" : ""}`;
      icon.replaceChildren(
        ...(model.icon?.build ? [model.icon.build()] : []),
        ...(model.icon?.text !== undefined ? [document.createTextNode(model.icon.text)] : []),
      );
    });
    part("head", [model.kicker, model.title], () => {
      kicker.textContent = model.kicker;
      title.textContent = model.title;
    });
    part("groups", model.groups, () => paintGroups(model.groups));
    part("notes", model.notes ?? [], () => {
      notes.hidden = !model.notes?.length;
      notes.replaceChildren(
        ...(model.notes ?? []).map((n) =>
          el("p", `pulso-card__note pulso-card__note--${n.kind ?? "plain"}`, n.text),
        ),
      );
    });
    part("updated", model.updated ?? null, () => {
      updated.hidden = !model.updated;
      updated.textContent = model.updated?.text ?? "";
      updated.title = model.updated?.title ?? "";
    });
    part("attribution", model.attribution ?? null, () => {
      const a = model.attribution;
      attribution.hidden = !a;
      attribution.replaceChildren();
      if (!a) return;
      if (a.href) {
        const link = el("a", undefined, a.text);
        link.href = a.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        attribution.append(link);
      } else {
        attribution.textContent = a.text;
      }
    });
  }

  function release(slot: Slot, userClosed: boolean): void {
    if (current !== slot) return;
    const hadFocus = root.contains(document.activeElement);
    current = null;
    root.hidden = true;
    live.textContent = "";
    done = {};
    document.removeEventListener("keydown", onKey);
    if (userClosed || hadFocus) {
      const target = slot.hooks.returnFocus?.() ?? slot.opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  }

  function userClose(): void {
    const slot = current;
    if (!slot) return;
    release(slot, true);
    slot.hooks.onClose();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.defaultPrevented) userClose();
  }

  close.addEventListener("click", userClose);

  return {
    root,
    isCurrent: (slot) => current === slot,
    show(slot, model, announce) {
      if (current !== slot) {
        const prev = current;
        if (prev) {
          // Otra capa abre su tarjeta: la anterior suelta su selección y el panel se reutiliza.
          current = null;
          live.textContent = "";
          prev.hooks.onClose();
          done = {};
        }
        const active = document.activeElement;
        slot.opener =
          active instanceof HTMLElement && active !== document.body && !root.contains(active)
            ? active
            : null;
        current = slot;
        close.setAttribute("aria-label", slot.hooks.t("card.close"));
        root.hidden = false;
        document.addEventListener("keydown", onKey);
        paint(model);
        root.focus({ preventScroll: true });
      } else {
        paint(model);
      }
      if (announce) live.textContent = summarize(model);
    },
    release,
    destroy() {
      document.removeEventListener("keydown", onKey);
      const slot = current;
      current = null;
      root.remove();
      // La capa que lo tenía abierto suelta su selección (no queda `aria-expanded` huérfano).
      slot?.hooks.onClose();
    },
  };
}

/** Vista de una capa sobre el panel compartido de `host`. */
export function createCardView(host: HTMLElement, owner: CardLayer, hooks: CardHooks): CardView {
  const slot: Slot = { owner, hooks, opener: null };
  panelFor(host); // el panel existe (oculto) desde que la capa crea su vista
  /** El panel ya creado (sin crearlo solo para consultarlo). */
  const existing = (): Panel | undefined => {
    const p = panels.get(host);
    return p?.root.isConnected ? p : undefined;
  };
  return {
    show: (model, announce = false) => panelFor(host).show(slot, model, announce),
    hide: () => existing()?.release(slot, false),
    get visible() {
      return existing()?.isCurrent(slot) ?? false;
    },
    get element() {
      return panelFor(host).root;
    },
    destroy() {
      existing()?.release(slot, false);
    },
  };
}

/**
 * Vista diferida sobre el panel de `#app` (o `body`), resuelto en cada llamada: sigue valiendo si el
 * anfitrión se sustituye (recarga en caliente, tests).
 */
export function lazyCardView(owner: CardLayer, hooks: CardHooks): () => CardView {
  let view: CardView | null = null;
  let at: HTMLElement | null = null;
  return () => {
    const host = document.getElementById("app") ?? document.body;
    if (!view || at !== host) {
      view?.destroy();
      view = createCardView(host, owner, hooks);
      at = host;
    }
    return view;
  };
}
