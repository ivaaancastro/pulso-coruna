import type { Pulse } from "@pulso/schema";

/**
 * Vista previa de enlaces (M8.5, `docs/specs/M8.5-clip-og.md`, ADR-0029). Todo este módulo es PURO:
 * recibe el último punto del índice Pulso ya calculado y devuelve el HTML con las metas Open Graph.
 * Los _scrapers_ no ejecutan JS, así que el estado real solo puede venir en este HTML.
 */

export const SHARE_LANGS = ["es", "gl", "en"] as const;
export type ShareLang = (typeof SHARE_LANGS)[number];
export const DEFAULT_SHARE_LANG: ShareLang = "es";

/** Un punto del índice sin más de esta antigüedad cuenta como «dato actual» (ms). */
export const SHARE_MAX_AGE_MS = 20 * 60_000;
/** Tramo y ventana que se piden a `computePulse` para sacar el último punto. */
export const SHARE_STEP_MS = 5 * 60_000;
export const SHARE_WINDOW_MS = 35 * 60_000;

export const SHARE_IMAGE_PATH = "/og.png";
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export interface SharePoint {
  /** Índice 0–100 del último tramo con datos. */
  value: number;
  /** Inicio del tramo, epoch ms UTC. */
  ts: number;
  profile: Pulse["profile"];
}

interface ShareTexts {
  name: string;
  description: string;
  imageAlt: string;
  locale: string;
  intl: string;
  /** `{value}`, `{time}`, `{description}` */
  withData: string;
  fixed: string;
  open: string;
}

const TEXTS: Record<ShareLang, ShareTexts> = {
  es: {
    name: "Pulso A Coruña",
    description:
      "A Coruña como un organismo vivo: buses, bicis, viento, mareas, barcos, aire y aviones.",
    imageAlt: "Pulso A Coruña: la ciudad de noche, vista desde arriba, con sus datos como luz",
    locale: "es_ES",
    intl: "es-ES",
    withData: "Índice Pulso: {value} de 100 a las {time} (hora de A Coruña){fixed}. {description}",
    fixed: "; perfil fijo: nivel sin calibrar",
    open: "Abrir Pulso A Coruña",
  },
  gl: {
    name: "Pulso A Coruña",
    description:
      "A Coruña como un organismo vivo: autobuses, bicis, vento, mareas, barcos, aire e avións.",
    imageAlt: "Pulso A Coruña: a cidade de noite, vista desde arriba, cos seus datos como luz",
    locale: "gl_ES",
    intl: "gl-ES",
    withData: "Índice Pulso: {value} de 100 ás {time} (hora da Coruña){fixed}. {description}",
    fixed: "; perfil fixo: nivel sen calibrar",
    open: "Abrir Pulso A Coruña",
  },
  en: {
    name: "Pulso A Coruña",
    description: "A Coruña as a living organism: buses, bikes, wind, tides, ships, air and planes.",
    imageAlt: "Pulso A Coruña: the city at night seen from above, its data as light",
    locale: "en_GB",
    intl: "en-GB",
    withData: "Pulso index: {value} out of 100 at {time} (A Coruña time){fixed}. {description}",
    fixed: "; fixed profile: level not calibrated",
    open: "Open Pulso A Coruña",
  },
};

export function parseShareLang(raw: unknown): ShareLang {
  return typeof raw === "string" && (SHARE_LANGS as readonly string[]).includes(raw)
    ? (raw as ShareLang)
    : DEFAULT_SHARE_LANG;
}

/**
 * `SHARE_BASE_URL`: origen público de la web (`https://pulso.example`, con ruta opcional). Sin valor →
 * `null` (endpoint desactivado). Solo http(s), sin credenciales, query ni hash; sin barra final.
 */
export function parseShareBaseUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`SHARE_BASE_URL no es una URL válida (recibido "${raw}")`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("SHARE_BASE_URL debe ser http(s)");
  if (url.username !== "" || url.password !== "")
    throw new Error("SHARE_BASE_URL no puede llevar credenciales");
  if (url.search !== "" || url.hash !== "")
    throw new Error("SHARE_BASE_URL no puede llevar query ni hash");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Escapa para texto y para atributos entre comillas simples o dobles. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Último punto del índice si es reciente y válido; `null` si no hay datos (de ahí sale el texto neutro).
 * No se fía del tipo: un valor no finito o fuera de rango no se publica.
 */
export function latestSharePoint(pulse: Pulse, now: number): SharePoint | null {
  const last = pulse.points[pulse.points.length - 1];
  if (!last) return null;
  if (!Number.isFinite(last.value) || last.value < 0 || last.value > 100) return null;
  if (now - last.ts > SHARE_MAX_AGE_MS) return null;
  return { value: last.value, ts: last.ts, profile: pulse.profile };
}

export interface ShareText {
  title: string;
  description: string;
}

/** Título y descripción para un idioma; sin punto → neutros (la descripción genérica de la app). */
export function shareText(lang: ShareLang, point: SharePoint | null): ShareText {
  const x = TEXTS[lang];
  if (!point) return { title: x.name, description: x.description };
  const time = new Intl.DateTimeFormat(x.intl, {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(point.ts);
  const value = String(Math.round(point.value));
  const description = x.withData
    .replace("{value}", value)
    .replace("{time}", time)
    .replace("{fixed}", point.profile === "fixed" ? x.fixed : "")
    .replace("{description}", x.description);
  return { title: `${x.name} · ${value}/100`, description };
}

/** HTML mínimo con las metas OG/Twitter y redirección al visitante. TODO valor insertado va escapado. */
export function renderSharePage(o: {
  baseUrl: string;
  lang: ShareLang;
  point: SharePoint | null;
}): string {
  const x = TEXTS[o.lang];
  const { title, description } = shareText(o.lang, o.point);
  const target = o.lang === DEFAULT_SHARE_LANG ? `${o.baseUrl}/` : `${o.baseUrl}/?lang=${o.lang}`;
  const image = `${o.baseUrl}${SHARE_IMAGE_PATH}`;
  const e = escapeHtml;
  const meta = (attr: "name" | "property", key: string, value: string): string =>
    `<meta ${attr}="${key}" content="${e(value)}" />`;
  return [
    "<!doctype html>",
    `<html lang="${o.lang}">`,
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${e(title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${e(target)}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", x.name),
    meta("property", "og:locale", x.locale),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", target),
    meta("property", "og:image", image),
    meta("property", "og:image:width", String(SHARE_IMAGE_SIZE.width)),
    meta("property", "og:image:height", String(SHARE_IMAGE_SIZE.height)),
    meta("property", "og:image:alt", x.imageAlt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", x.imageAlt),
    `<meta http-equiv="refresh" content="0;url=${e(target)}" />`,
    "</head>",
    `<body><p><a href="${e(target)}">${e(x.open)}</a></p></body>`,
    "</html>",
    "",
  ].join("\n");
}

/** `Cache-Control` de la página (el cálculo ya se reutiliza `shareCacheMs`; el navegador y las CDN, igual). */
export const shareCacheControl = (maxAgeS: number): string => `public, max-age=${maxAgeS}`;
