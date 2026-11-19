import type { Translate } from "../../../i18n";
import type { CardModel } from "../../card/panel";
import type { Rgb } from "./line-color";
import type { BusInfo } from "./meta";

/** Modelo de la tarjeta de un bus, ya traducido y sin DOM (lo pinta el panel común `live/card`). */
export function formatBusCard(info: BusInfo, t: Translate, color?: Rgb): CardModel {
  const rows = [];
  if (info.headsign !== undefined)
    rows.push({ label: t("bus.card.headsign"), value: info.headsign });
  if (info.nextStop !== undefined)
    rows.push({ label: t("bus.card.nextStop"), value: info.nextStop });
  return {
    layer: "bus",
    label: t("bus.card.region"),
    kicker: t("bus.name"),
    title:
      info.line !== undefined ? t("bus.card.title", { line: info.line }) : t("bus.card.untitled"),
    // El distintivo lleva el número de línea y su color (el color solo no la identifica).
    accent: color && `rgb(${color[0]} ${color[1]} ${color[2]})`,
    icon: info.line !== undefined ? { text: info.line } : undefined,
    groups: rows.length ? [{ rows }] : [],
    // «Estimado según horario»: solo cuando la posición es una estimación, con trazo discontinuo.
    notes: info.estimated ? [{ text: t("bus.card.estimated"), kind: "estimated" }] : [],
  };
}
