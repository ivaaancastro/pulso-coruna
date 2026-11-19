import { INTL_LOCALE, type Locale, type MessageKey, type Translate } from "../../../i18n";
import { freshness, type CardModel, type CardRow } from "../../card/panel";
import type { ShipInfo, ShipKind } from "./meta";
import { isMoored, toKnots } from "./model";

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
): CardModel {
  const intl = INTL_LOCALE[locale];
  const typeLabel = t(KIND_KEY[info.kind]);
  const title = info.name ?? typeLabel;
  const rows: CardRow[] = [];
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
  return {
    layer: "ship",
    label: t("ship.card.region"),
    kicker: t("ship.name"),
    title,
    groups: rows.length ? [{ rows }] : [],
    updated: freshness(t, info.ts, now, locale),
    attribution: { text: t("ship.card.source") },
  };
}
