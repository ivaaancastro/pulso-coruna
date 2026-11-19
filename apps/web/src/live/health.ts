import type { LayerId } from "@pulso/schema";
import { SOURCE_THRESHOLDS } from "./source-status";

// Sin importar `@pulso/schema` en tiempo de ejecución: arrastraría zod al hilo principal (~28 KB gzip).
const LAYER_IDS = Object.keys(SOURCE_THRESHOLDS) as LayerId[];

/** `/api/v1/health` de nuestra API a partir de la URL del stream; `null` si no se puede derivar. */
export function resolveHealthUrl(streamUrl: string): string | null {
  try {
    const url = new URL(streamUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = url.pathname.replace(/\/stream$/, "/health");
    if (!url.pathname.endsWith("/health")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Última marca de dato por capa según la API (`null` = sin datos). Tolerante a respuestas mal formadas. */
export type HealthLastData = Partial<Record<LayerId, number | null>>;

export function parseHealth(body: unknown): HealthLastData | null {
  if (typeof body !== "object" || body === null) return null;
  const layers = (body as { layers?: unknown }).layers;
  if (typeof layers !== "object" || layers === null) return null;
  const out: HealthLastData = {};
  for (const id of LAYER_IDS) {
    const entry = (layers as Record<string, unknown>)[id];
    if (typeof entry !== "object" || entry === null) continue;
    const at = (entry as { lastDataAt?: unknown }).lastDataAt;
    if (at === null) out[id] = null;
    else if (typeof at === "number" && Number.isFinite(at) && at > 0) out[id] = at;
    else if (typeof at === "string" && Number.isFinite(Date.parse(at))) out[id] = Date.parse(at);
  }
  return out;
}

export type FetchHealth = (url: string, signal: AbortSignal) => Promise<unknown>;

export const defaultFetchHealth: FetchHealth = async (url, signal) => {
  const res = await fetch(url, { signal, cache: "no-store", credentials: "omit" });
  // La API responde 503 con cuerpo válido cuando la BD cae: igualmente es información.
  return res.json();
};
