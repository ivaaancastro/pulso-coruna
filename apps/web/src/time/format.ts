/** Zona de visualización. Internamente todo es UTC epoch ms. */
export const DISPLAY_TZ = "Europe/Madrid";

export function formatMadridTime(epochMs: number, locale = "es-ES"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(epochMs);
}

export function formatMadridDate(epochMs: number, locale = "es-ES"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: DISPLAY_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(epochMs);
}

/**
 * «hace 2 min» / «ahora»: antigüedad de un dato respecto a `nowMs` (ambos UTC epoch ms). No depende
 * de la zona horaria; los desfases negativos del reloj se tratan como «ahora».
 */
export function formatAgo(thenMs: number, nowMs: number, locale = "es-ES"): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (seconds < 60) return rtf.format(0, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

/** Milisegundos hasta el siguiente minuto exacto (UTC y Madrid coinciden en minutos). */
export function msToNextMinute(epochMs: number): number {
  return 60_000 - (epochMs % 60_000);
}
