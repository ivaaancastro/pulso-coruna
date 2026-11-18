/**
 * Adaptador iTranvías (capa `bus`). API no oficial (`queryitr_v3.php`, func=99): ver
 * `docs/sources/itranvias.md` y `docs/specs/M3.4-adaptador-itranvias.md`.
 *
 * DESACTIVADO por defecto: el permiso de uso sigue sin confirmar (M1.5). Mientras `enabled` sea
 * false, `fetch` no toca la red. Se activa con `ITRANVIAS_ENABLED=true` (ver `.env.example`).
 */
import { EntitySchema, type Adapter, type Entity } from "@pulso/schema";
import { httpGetJson, type HttpOptions } from "../common/http.js";

export const BASE_URL = "https://itranvias.com/queryitr_v3.php";

/** id interno de línea -> número comercial (nota de la fuente, catálogo func=7 de 2026-11-18). */
export const LINE_IDS: Readonly<Record<string, string>> = {
  "100": "1",
  "1900": "1A",
  "200": "2",
  "800": "2A",
  "300": "3",
  "301": "3A",
  "400": "4",
  "500": "5",
  "600": "6",
  "601": "6A",
  "700": "7",
  "1100": "11",
  "1200": "12",
  "1500": "12A",
  "1400": "14",
  "1700": "17",
  "2000": "20",
  "2100": "21",
  "2200": "22",
  "2300": "23",
  "2301": "23A",
  "2400": "24",
  "1800": "BUH",
  "1801": "BUH",
  "2450": "UDC",
  "2451": "UDC",
};

/** Suelo duro del ciclo completo: la web oficial refresca cada 15 s, nunca vamos más rápido. */
export const MIN_CYCLE_MS = 15_000;
/** Intervalo por defecto: 30 s (26 peticiones/ciclo ≈ 52/min, la mitad que la web oficial). */
export const DEFAULT_INTERVAL_MS = 30_000;
/** Pausa entre peticiones consecutivas (concurrencia 1): 26 líneas ≈ 20 s de reparto por ciclo. */
export const DEFAULT_PAUSE_MS = 750;
/** Si fallan tantas líneas seguidas se corta el ciclo (no insistir contra una fuente caída). */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface ItranviasConfig {
  /** Interruptor general. Por defecto false (permiso sin confirmar). */
  enabled?: boolean;
  /** Intervalo entre ciclos; se fuerza a >= MIN_CYCLE_MS. */
  intervalMs?: number;
  pauseMs?: number;
  timeoutMs?: number;
  /** Ids internos a sondear; por defecto todas las de LINE_IDS. */
  lineIds?: readonly string[];
  /** Inyectables para tests (nunca se llama a la API real desde los tests). */
  get?: (url: string, signal: AbortSignal, options?: HttpOptions) => Promise<unknown>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface ItranviasLineRaw {
  lineId: string;
  /** Epoch ms UTC de recepción (la API no da hora de posición). */
  receivedAt: number;
  body: unknown;
}

export interface ItranviasRaw {
  lines: ItranviasLineRaw[];
  /** Líneas que fallaron en este ciclo (no abortan el resto). */
  errors: { lineId: string; message: string }[];
}

/** Lee el interruptor del entorno: solo "true" (exacto) activa. */
export function itranviasConfigFromEnv(
  env: Record<string, string | undefined>,
): Pick<ItranviasConfig, "enabled" | "intervalMs"> {
  const min = Number(env.ITRANVIAS_MIN_INTERVAL_MS);
  return {
    enabled: env.ITRANVIAS_ENABLED === "true",
    ...(Number.isFinite(min) && min > 0 ? { intervalMs: min } : {}),
  };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function lineUrl(lineId: string): string {
  return `${BASE_URL}?dato=${encodeURIComponent(lineId)}&mostrar=B&func=99`;
}

export function createItranviasAdapter(
  config: ItranviasConfig = {},
): Adapter<Entity> & { enabled: boolean } {
  const enabled = config.enabled ?? false;
  const intervalMs = Math.max(config.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_CYCLE_MS);
  const pauseMs = Math.max(config.pauseMs ?? DEFAULT_PAUSE_MS, 0);
  const lineIds = config.lineIds ?? Object.keys(LINE_IDS);
  const get = config.get ?? httpGetJson;
  const sleep = config.sleep ?? defaultSleep;
  const now = config.now ?? Date.now;
  let lastCycleStart = Number.NEGATIVE_INFINITY;

  return {
    id: "itranvias",
    intervalMs,
    enabled,
    async fetch(signal) {
      const raw: ItranviasRaw = { lines: [], errors: [] };
      if (!enabled) return raw;
      const start = now();
      if (start - lastCycleStart < MIN_CYCLE_MS) return raw; // guarda: nunca ciclos < 15 s
      lastCycleStart = start;

      let consecutive = 0;
      for (let i = 0; i < lineIds.length; i++) {
        const lineId = lineIds[i] as string;
        if (i > 0) await sleep(pauseMs, signal);
        try {
          const body = await get(lineUrl(lineId), signal, {
            timeoutMs: config.timeoutMs ?? 10_000,
          });
          raw.lines.push({ lineId, receivedAt: now(), body });
          consecutive = 0;
        } catch (err) {
          if (signal.aborted) throw err; // cancelación: se propaga, no es fallo de línea
          raw.errors.push({ lineId, message: err instanceof Error ? err.message : String(err) });
          if (++consecutive >= MAX_CONSECUTIVE_FAILURES) break;
        }
      }
      return raw;
    },
    parse: parseItranvias,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Caja de A Coruña y alrededores (skill new-adapter). */
function inCoruna(lon: number, lat: number): boolean {
  return lon >= -8.6 && lon <= -8.3 && lat >= 43.3 && lat <= 43.45;
}

/** Puro. Tolera `mapas:[[]]`, campos ausentes y coordenadas inválidas (se descartan). */
export function parseItranvias(raw: unknown): Entity[] {
  if (!isObj(raw) || !Array.isArray(raw.lines)) return [];
  const out = new Map<string, Entity>();
  for (const line of raw.lines) {
    if (!isObj(line) || typeof line.lineId !== "string" || typeof line.receivedAt !== "number") {
      continue;
    }
    const body = line.body;
    if (!isObj(body) || body.resultado !== "OK" || !Array.isArray(body.mapas)) continue;
    const commercial = LINE_IDS[line.lineId];
    for (const mapa of body.mapas) {
      if (!isObj(mapa) || !Array.isArray(mapa.buses)) continue; // `[]` = sin servicio
      for (const dir of mapa.buses) {
        if (!isObj(dir) || !Array.isArray(dir.buses)) continue;
        const sentido = typeof dir.sentido === "string" ? Number(dir.sentido) : NaN;
        for (const b of dir.buses) {
          if (
            !isObj(b) ||
            typeof b.bus !== "number" ||
            typeof b.posx !== "number" ||
            typeof b.posy !== "number" ||
            !inCoruna(b.posx, b.posy)
          ) {
            continue;
          }
          const entity = EntitySchema.safeParse({
            id: String(b.bus),
            layer: "bus",
            lon: b.posx,
            lat: b.posy,
            ts: line.receivedAt,
            meta: {
              source: "itranvias",
              lineId: line.lineId,
              ...(commercial ? { line: commercial } : {}),
              ...(Number.isFinite(sentido) ? { direction: sentido } : {}),
            },
          });
          if (entity.success && !out.has(entity.data.id)) out.set(entity.data.id, entity.data);
        }
      }
    }
  }
  return [...out.values()];
}
