import { PulseSchema } from "@pulso/schema";
import { PulseFetchError } from "./errors";
import type { PulseData, PulseWindow } from "./model";

export { PulseFetchError };

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function pulseRequestUrl(base: string, w: PulseWindow): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}from=${w.from}&to=${w.to}&step=${w.stepMs}`;
}

/** Pide la serie a NUESTRA API y la valida con `PulseSchema`; lanza `PulseFetchError`. */
export async function fetchPulse(
  base: string,
  w: PulseWindow,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PulseData> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(pulseRequestUrl(base, w), {
      ...(signal ? { signal } : {}),
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new PulseFetchError("sin conexión con la API", "error");
  }
  if (!res.ok) {
    throw new PulseFetchError(`HTTP ${res.status}`, res.status === 400 ? "nodata" : "error");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PulseFetchError("la respuesta no es JSON", "error");
  }
  const parsed = PulseSchema.safeParse(body);
  if (!parsed.success) throw new PulseFetchError("respuesta fuera de contrato", "error");
  const { from, to, stepMs, profile, points } = parsed.data;
  return { from, to, stepMs, profile, points };
}
