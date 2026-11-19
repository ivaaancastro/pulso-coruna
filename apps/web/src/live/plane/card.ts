import type { Translate } from "../../i18n";
import { formatAgo } from "../../time/format";
import type { PlaneEstimate } from "./extrapolate";
import type { PlaneInfo } from "./meta";

/** Contenido de la tarjeta de un avión, ya traducido y sin HTML (lo pinta `card-view.ts`). */
export interface PlaneCardContent {
  title: string;
  rows: { label: string; value: string }[];
  /** «Posición estimada hace X» / «Posición registrada hace X». */
  note: string;
  /** `true` si la posición se está extrapolando (la nota se pinta con trazo discontinuo). */
  estimated: boolean;
  source: string;
  summary: string;
}

const FT_PER_M = 3.280839895;
const KMH_PER_MS = 3.6;
const KN_PER_MS = 1.943844492;

export const metersToFeet = (m: number): number => m * FT_PER_M;
export const msToKmh = (v: number): number => v * KMH_PER_MS;
export const msToKnots = (v: number): number => v * KN_PER_MS;

/** `intl`: etiqueta BCP 47 (`INTL_LOCALE`). `now`: reloj de la app. */
export function formatPlaneCard(
  info: PlaneInfo,
  est: PlaneEstimate,
  now: number,
  t: Translate,
  intl: string,
): PlaneCardContent {
  const nf = new Intl.NumberFormat(intl, { maximumFractionDigits: 0 });
  const rows: PlaneCardContent["rows"] = [];
  if (info.onGround) {
    rows.push({ label: t("plane.card.altitude"), value: t("plane.card.onGround") });
  } else if (info.altM !== undefined) {
    rows.push({
      label: t("plane.card.altitude"),
      value: t("plane.card.altitude.value", {
        m: nf.format(info.altM),
        ft: nf.format(metersToFeet(info.altM)),
      }),
    });
  }
  if (info.speed !== undefined) {
    rows.push({
      label: t("plane.card.speed"),
      value: t("plane.card.speed.value", {
        kmh: nf.format(msToKmh(info.speed)),
        kn: nf.format(msToKnots(info.speed)),
      }),
    });
  }
  if (info.heading !== undefined) {
    rows.push({
      label: t("plane.card.heading"),
      value: t("plane.card.heading.value", { deg: nf.format(Math.round(info.heading) % 360) }),
    });
  }
  const ago = formatAgo(info.ts, now, intl);
  const note = t(est.extrapolated ? "plane.card.estimated" : "plane.card.reported", { ago });
  const title = info.callsign ?? t("plane.card.untitled");
  const source = t("plane.card.source");
  const summary = [title, ...rows.map((r) => `${r.label}: ${r.value}`), note, source].join(". ");
  return { title, rows, note, estimated: est.extrapolated, source, summary };
}
