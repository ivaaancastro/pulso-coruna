import type { Translate } from "../../../i18n";
import type { BusInfo } from "./meta";

/** Contenido de la tarjeta de un bus, ya traducido y sin HTML (lo pinta `card-view.ts`). */
export interface BusCardContent {
  /** «Línea 3» (o «Autobús» si no hay línea). */
  title: string;
  /** Línea tal cual, para el distintivo de color. */
  line?: string;
  /** Filas con datos; las que faltan en el dato no se muestran. */
  rows: { label: string; value: string }[];
  /** «Estimado según horario»: solo cuando la posición es una estimación. */
  note?: string;
  /** Resumen para lectores de pantalla. */
  summary: string;
}

export function formatBusCard(info: BusInfo, t: Translate): BusCardContent {
  const title =
    info.line !== undefined ? t("bus.card.title", { line: info.line }) : t("bus.card.untitled");
  const rows: BusCardContent["rows"] = [];
  if (info.headsign !== undefined)
    rows.push({ label: t("bus.card.headsign"), value: info.headsign });
  if (info.nextStop !== undefined)
    rows.push({ label: t("bus.card.nextStop"), value: info.nextStop });
  const note = info.estimated ? t("bus.card.estimated") : undefined;
  const summary = [
    title,
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(note ? [note] : []),
  ].join(". ");
  return { title, line: info.line, rows, note, summary };
}
