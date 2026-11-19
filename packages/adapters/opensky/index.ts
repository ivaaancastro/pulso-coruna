/**
 * Adaptador OpenSky Network (capa `plane`). Ver `docs/sources/opensky.md` y
 * `docs/specs/M5.1d-adaptador-aviones.md`.
 *
 * Fuente: OpenSky Network (https://opensky-network.org). Atribución obligatoria al mostrar.
 * Anónimo por defecto (400 créditos/día por IP); credenciales OAuth2 opcionales SOLO en servidor.
 */
import { EntitySchema, type Adapter, type Entity } from "@pulso/schema";
import { USER_AGENT } from "../common/http.js";

export const STATES_URL = "https://opensky-network.org/api/states/all";
export const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
/** bbox de A Coruña (0,11 grados² => 1 crédito por petición). */
export const DEFAULT_BBOX = { lamin: 43.25, lomin: -8.65, lamax: 43.5, lomax: -8.2 } as const;
/** 5 min => 288 peticiones/día, dentro de los 400 créditos anónimos. */
export const DEFAULT_INTERVAL_MS = 300_000;
/** Suelo del intervalo: por debajo se agotaría la cuota anónima en pocas horas. */
export const MIN_INTERVAL_MS = 60_000;
/** Aviso cuando `x-rate-limit-remaining` baja de este umbral. */
export const DEFAULT_QUOTA_WARN_AT = 40;
/** Espera por defecto tras un 429 sin cabecera válida. */
export const DEFAULT_RETRY_AFTER_MS = 3_600_000;

/** Error tipado de 429: la ingesta puede esperar `retryAfterMs` en lugar de reintentar. */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`OpenSky: cuota agotada (429), reintentar en ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface OpenskyConfig {
  enabled?: boolean;
  intervalMs?: number;
  bbox?: { lamin: number; lomin: number; lamax: number; lomax: number };
  timeoutMs?: number;
  quotaWarnAt?: number;
  /** OAuth2 client credentials (solo servidor). Sin ellas, anónimo. */
  clientId?: string;
  clientSecret?: string;
  /** Inyectables para tests (nunca se llama a la API real desde los tests). */
  fetchFn?: typeof fetch;
  now?: () => number;
  warn?: (msg: string, fields?: Record<string, unknown>) => void;
}

export interface OpenskyRaw {
  /** Epoch ms UTC de la petición (respaldo de `ts`). */
  fetchedAt: number;
  body: unknown;
  /** `x-rate-limit-remaining`, si la fuente lo envía. */
  creditsRemaining?: number;
}

/** Lee el entorno: solo "true" activa; intervalo y credenciales opcionales. */
export function openskyConfigFromEnv(
  env: Record<string, string | undefined>,
): Pick<OpenskyConfig, "enabled" | "intervalMs" | "clientId" | "clientSecret"> {
  const ms = Number(env.OPENSKY_INTERVAL_MS);
  return {
    enabled: env.OPENSKY_ENABLED === "true",
    ...(Number.isFinite(ms) && ms > 0 ? { intervalMs: ms } : {}),
    ...(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET
      ? { clientId: env.OPENSKY_CLIENT_ID, clientSecret: env.OPENSKY_CLIENT_SECRET }
      : {}),
  };
}

export function statesUrl(bbox: NonNullable<OpenskyConfig["bbox"]> = DEFAULT_BBOX): string {
  const q = new URLSearchParams({
    lamin: String(bbox.lamin),
    lomin: String(bbox.lomin),
    lamax: String(bbox.lamax),
    lomax: String(bbox.lomax),
  });
  return `${STATES_URL}?${q.toString()}`;
}

export function createOpenskyAdapter(
  config: OpenskyConfig = {},
): Adapter<Entity> & { enabled: boolean } {
  const enabled = config.enabled ?? false;
  const intervalMs = Math.max(config.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  const doFetch = config.fetchFn ?? fetch;
  const now = config.now ?? Date.now;
  const warn = config.warn ?? ((msg, f) => console.warn(msg, f));
  const warnAt = config.quotaWarnAt ?? DEFAULT_QUOTA_WARN_AT;
  const url = statesUrl(config.bbox);
  const timeoutMs = config.timeoutMs ?? 15_000;
  let blockedUntil = 0;
  let token: { value: string; expiresAt: number } | undefined;

  async function bearer(signal: AbortSignal): Promise<string | undefined> {
    if (!config.clientId || !config.clientSecret) return undefined;
    if (token && token.expiresAt > now() + 30_000) return token.value;
    const res = await doFetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`OpenSky: token OAuth2 HTTP ${res.status}`);
    const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string") throw new Error("OpenSky: respuesta de token inválida");
    const ttl = typeof j.expires_in === "number" ? j.expires_in : 300;
    token = { value: j.access_token, expiresAt: now() + ttl * 1000 };
    return token.value;
  }

  return {
    id: "opensky",
    intervalMs,
    enabled,
    async fetch(signal) {
      const fetchedAt = now();
      if (!enabled) return { fetchedAt, body: { states: null } } satisfies OpenskyRaw;
      // Enfriamiento tras un 429: no se toca la red hasta que pase `Retry-After`.
      if (fetchedAt < blockedUntil) throw new RateLimitError(blockedUntil - fetchedAt);
      const auth = await bearer(signal);
      const res = await doFetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { "User-Agent": USER_AGENT, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      });
      if (res.status === 429) {
        const secs = Number(res.headers.get("x-rate-limit-retry-after-seconds"));
        const wait = Number.isFinite(secs) && secs > 0 ? secs * 1000 : DEFAULT_RETRY_AFTER_MS;
        blockedUntil = fetchedAt + wait;
        throw new RateLimitError(wait);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${STATES_URL}`);
      const remainingHeader = res.headers.get("x-rate-limit-remaining");
      const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
      const raw: OpenskyRaw = { fetchedAt, body: await res.json() };
      if (Number.isFinite(remaining)) {
        raw.creditsRemaining = remaining;
        if (remaining <= warnAt) {
          warn("OpenSky: cuota diaria casi agotada", { creditsRemaining: remaining });
        }
      }
      return raw;
    },
    parse: parseOpensky,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Puro. `states: null` es válido (sin aeronaves). Índices: 0 icao24, 1 callsign, 3 time_position,
 * 4 last_contact (s), 5 lon, 6 lat, 7 baro_alt, 8 on_ground, 9 velocity (m/s), 10 true_track,
 * 11 vertical_rate, 13 geo_alt. `ts` en ms (la fuente da segundos). Descarta filas sin lon/lat.
 */
export function parseOpensky(raw: unknown): Entity[] {
  if (!isObj(raw) || !isObj(raw.body)) throw new Error("OpenSky: se esperaba { fetchedAt, body }");
  const body = raw.body;
  if (body.states === null || body.states === undefined) return [];
  if (!Array.isArray(body.states)) throw new Error("OpenSky: `states` no es un array");
  const fetchedAt = num(raw.fetchedAt);
  const bodyTime = num(body.time);
  const out = new Map<string, Entity>();
  for (const row of body.states) {
    if (!Array.isArray(row)) continue;
    const icao = row[0];
    const lon = num(row[5]);
    const lat = num(row[6]);
    if (typeof icao !== "string" || icao === "" || lon === undefined || lat === undefined) continue;
    const tsSec = num(row[3]) ?? num(row[4]) ?? bodyTime;
    const ts = tsSec !== undefined ? Math.round(tsSec * 1000) : fetchedAt;
    const track = num(row[10]);
    const velocity = num(row[9]);
    const alt = num(row[13]) ?? num(row[7]);
    const vrate = num(row[11]);
    const callsign = typeof row[1] === "string" ? row[1].trim() : "";
    const meta: Record<string, string | number> = { source: "opensky" };
    if (callsign) meta.callsign = callsign;
    if (alt !== undefined) meta.alt = alt;
    if (typeof row[8] === "boolean") meta.onGround = row[8] ? 1 : 0;
    if (vrate !== undefined) meta.vrate = vrate;
    const parsed = EntitySchema.safeParse({
      id: icao,
      layer: "plane",
      lon,
      lat,
      ...(track !== undefined && track >= 0 && track <= 360 ? { heading: track } : {}),
      ...(velocity !== undefined && velocity >= 0 ? { speed: velocity } : {}),
      ts,
      meta,
    });
    if (parsed.success) out.set(parsed.data.id, parsed.data);
  }
  return [...out.values()];
}
