import type { Translate } from "../../i18n";
import { formatAgo } from "../../time/format";
import type { CardModel, CardRow } from "../card/panel";
import type { PlaneEstimate } from "./extrapolate";
import type { PlaneInfo } from "./meta";

const FT_PER_M = 3.280839895;
const KMH_PER_MS = 3.6;
const KN_PER_MS = 1.943844492;

export const metersToFeet = (m: number): number => m * FT_PER_M;
export const msToKmh = (v: number): number => v * KMH_PER_MS;
export const msToKnots = (v: number): number => v * KN_PER_MS;

const formats = new Map<string, Intl.NumberFormat>();

/** `intl`: etiqueta BCP 47 (`INTL_LOCALE`). `now`: reloj de la app. */
export function formatPlaneCard(
  info: PlaneInfo,
  est: PlaneEstimate,
  now: number,
  t: Translate,
  intl: string,
): CardModel {
  let nf = formats.get(intl);
  if (!nf) {
    nf = new Intl.NumberFormat(intl, { maximumFractionDigits: 0 });
    formats.set(intl, nf);
  }
  const rows: CardRow[] = [];
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
  // La nota de frescura es la propia posición: estimada (trazo discontinuo) o registrada.
  const note = t(est.extrapolated ? "plane.card.estimated" : "plane.card.reported", { ago });
  return {
    layer: "plane",
    label: t("plane.card.region"),
    kicker: t("plane.name"),
    title: info.callsign ?? t("plane.card.untitled"),
    groups: rows.length ? [{ rows }] : [],
    notes: [{ text: note, kind: est.extrapolated ? "estimated" : "plain" }],
    attribution: { text: t("plane.card.source") },
  };
}
