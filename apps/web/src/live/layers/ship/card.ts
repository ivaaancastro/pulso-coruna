import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../../../i18n";
import { formatAgo, formatMadridTime } from "../../../time/format";
import type { ShipInfo, ShipKind } from "./meta";
import { isMoored, toKnots } from "./model";

/** Contenido de la tarjeta de un barco, ya traducido y sin HTML (lo pinta `card-view.ts`). */
export interface ShipCardContent {
  title: string;
  /** Filas con datos; las que faltan en el dato no se muestran. */
  rows: { label: string; value: string }[];
  /** «Actualizado hace 2 min» y la hora de Madrid para `title`. */
  updated: string;
  updatedTitle: string;
  /** «Fuente: aisstream.io». */
  source: string;
  /** Resumen para lectores de pantalla (cambia con el dato, no con el reloj). */
  summary: string;
}

const KIND_KEY: Record<ShipKind, MessageKey> = {
  cargo: "ship.type.cargo",
  tanker: "ship.type.tanker",
  passenger: "ship.type.passenger",
  fishing: "ship.type.fishing",
  tug: "ship.type.tug",
  pleasure: "ship.type.pleasure",
  service: "ship.type.service",
  other: "ship.type.other",
};

export function formatShipCard(
  info: ShipInfo,
  t: Translate,
  locale: Locale,
  now: number,
): ShipCardContent {
  const intl = INTL_LOCALE[locale];
  const typeLabel = t(KIND_KEY[info.kind]);
  const title = info.name ?? typeLabel;
  const rows: ShipCardContent["rows"] = [];
  // Sin nombre el título ya es el tipo: no se repite.
  if (info.name !== undefined) rows.push({ label: t("ship.card.type"), value: typeLabel });
  if (info.speed !== undefined) {
    const knots = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(
      toKnots(info.speed),
    );
    rows.push({
      label: t("ship.card.speed"),
      value: isMoored(info.speed, info.navStatus)
        ? t("ship.card.stopped")
        : t("ship.card.knots", { value: knots }),
    });
  }
  if (info.heading !== undefined) {
    rows.push({
      label: t("ship.card.heading"),
      value: `${Math.round(info.heading) % 360}°`,
    });
  }
  const updated = t("ship.card.updated", { ago: formatAgo(info.ts, now, intl) });
  return {
    title,
    rows,
    updated,
    updatedTitle: formatMadridTime(info.ts, intl),
    source: t("ship.card.source"),
    summary: [title, ...rows.map((r) => `${r.label}: ${r.value}`)].join(". "),
  };
}
