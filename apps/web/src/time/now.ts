/**
 * Reloj de la app. En desarrollo, `?t=` fuerza la hora (ISO 8601 con zona, p. ej.
 * `?t=2026-11-18T22:30:00Z`, o epoch ms) para revisar de noche/día sin esperar; en producción
 * se ignora y el bloque se elimina del bundle.
 */
export function parseTimeOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("t");
  if (!raw) return null;
  const ms = /^\d{10,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function createNow(search: string): () => number {
  if (import.meta.env.DEV) {
    const forced = parseTimeOverride(search);
    if (forced !== null) return () => forced;
  }
  return Date.now;
}
