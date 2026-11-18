export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

/**
 * Espera antes del reintento número `attempt` (1 = tras el primer fallo):
 * `min(maxMs, baseMs * 2^(attempt-1))` con jitter en [50 %, 100 %] para no sincronizar reintentos.
 */
export function backoffDelay(
  attempt: number,
  { baseMs, maxMs }: BackoffOptions,
  random: () => number = Math.random,
): number {
  const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(cap / 2 + (cap / 2) * random());
}
