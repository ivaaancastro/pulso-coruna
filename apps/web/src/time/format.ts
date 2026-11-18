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

/** Milisegundos hasta el siguiente minuto exacto (UTC y Madrid coinciden en minutos). */
export function msToNextMinute(epochMs: number): number {
  return 60_000 - (epochMs % 60_000);
}
