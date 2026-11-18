/** Utilidades compartidas por los adaptadores. Solo `fetch` toca la red; `parse` es siempre puro. */

export const USER_AGENT = "PulsoACoruna/0.1 (+https://github.com/ivaaancastro/pulso-coruna)";

export interface HttpOptions {
  /** Tiempo máximo por petición. Por defecto 15 s. */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** GET con User-Agent identificable, timeout y cancelación externa. Lanza si el estado no es 2xx. */
export async function httpGet(
  url: string,
  signal: AbortSignal,
  { timeoutMs = 15_000, headers = {} }: HttpOptions = {},
): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    headers: { "User-Agent": USER_AGENT, ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res;
}

export async function httpGetJson(
  url: string,
  signal: AbortSignal,
  options?: HttpOptions,
): Promise<unknown> {
  return (await httpGet(url, signal, options)).json();
}
