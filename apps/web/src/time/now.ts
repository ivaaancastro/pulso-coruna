/**
 * Reloj de la app. En desarrollo, `?t=` fuerza la hora (ISO 8601 con zona, p. ej.
 * `?t=2026-11-18T22:30:00Z`, o epoch ms) para revisar de noche/día sin esperar; en producción
 * se ignora y el bloque se elimina del bundle.
 *
 * Modo Reproducir (M6.3): mientras dura, el reloj de la reproducción sustituye al de la app
 * (`setClockOverride`). Como todos los módulos piden la hora con `createNow(...)` (y el resultado
 * consulta el override en cada llamada), el día/noche del mapa, las tarjetas y las comprobaciones
 * de frescura siguen la hora reproducida sin tocar a ninguna capa.
 */
export function parseTimeOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("t");
  if (!raw) return null;
  const ms = /^\d{10,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

let override: (() => number) | null = null;

/** Sustituye (o, con `null`, restaura) el reloj de la app. Solo lo usa el modo Reproducir. */
export function setClockOverride(clock: (() => number) | null): void {
  override = clock;
}

/** Reloj «base» (sin override): `?t=` en desarrollo o la hora real. */
export function createBaseNow(search: string): () => number {
  if (import.meta.env.DEV) {
    const forced = parseTimeOverride(search);
    if (forced !== null) return () => forced;
  }
  return Date.now;
}

export function createNow(search: string): () => number {
  const base = createBaseNow(search);
  return () => (override ? override() : base());
}
