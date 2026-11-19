/**
 * Adaptador de barcos (capa `ship`) con aisstream.io. Ver `docs/sources/aisstream.md` y
 * `docs/specs/M5.1c-adaptador-barcos.md` (ADR-0023).
 *
 * A diferencia del resto, la fuente es un WebSocket de larga duración, no un sondeo. Encaje con el
 * contrato `Adapter` sin cambiarlo: un COLECTOR mantiene la conexión y un estado en memoria
 * (un barco por MMSI) y `fetch` devuelve el lote de posiciones nuevas desde el ciclo anterior;
 * `parse` es puro. La clave solo existe en el servidor y el MMSI nunca sale del adaptador (el `id`
 * es un hash con sal).
 */
import { createHash } from "node:crypto";
import { EntitySchema, type Adapter, type Entity } from "@pulso/schema";

export const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
/** Esquinas [lat, lon] de la zona (docs/sources/aisstream.md). */
export const BOUNDING_BOX: readonly [readonly [number, number], readonly [number, number]] = [
  [43.25, -8.65],
  [43.5, -8.2],
];
export const MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
] as const;

export const KNOT_MS = 0.514444;
export const DEFAULT_INTERVAL_MS = 15_000;
/** Un barco sin mensajes en este tiempo desaparece (los fondeados emiten cada ~3 min). */
export const DEFAULT_PURGE_MS = 10 * 60_000;
/** Sin mensajes con la conexión abierta durante este tiempo: se reconecta. */
export const DEFAULT_SILENCE_MS = 4 * 60_000;
/** Desconectado más tiempo que esto: `fetch` falla (source_health pasa a degraded/down). */
export const DEFAULT_DOWN_MS = 5 * 60_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/** Subconjunto del WebSocket estándar (global en Node 22+) que usamos; permite simularlo en tests. */
export interface WebSocketLike {
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface AisstreamLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface AisstreamConfig {
  /** `AISSTREAM_API_KEY`. Sin ella el adaptador no se crea (ver `aisstreamConfigFromEnv`). */
  apiKey: string;
  /** `SHIP_ID_SALT`: sal del hash que sustituye al MMSI. Obligatoria. */
  idSalt: string;
  intervalMs?: number;
  purgeMs?: number;
  silenceMs?: number;
  downMs?: number;
  /** Inyectables para tests: nunca se abre la red real desde los tests. */
  createSocket?: (url: string) => WebSocketLike;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  logger?: AisstreamLogger;
}

/** Lo que devuelve `fetch`: barcos con posición nueva (todavía con MMSI; no sale de este módulo). */
export interface ShipRaw {
  receivedAt: number;
  salt: string;
  ships: ShipState[];
}

export interface ShipState {
  mmsi: string;
  lat: number;
  lon: number;
  /** Epoch ms UTC de la posición (0 = aún sin posición, solo datos estáticos). */
  ts: number;
  /** Última actividad (cualquier mensaje), para la purga. */
  seenAt: number;
  /** nudos; ausente = no disponible */
  sogKn?: number;
  cog?: number;
  heading?: number;
  navStatus?: number;
  name?: string;
  shipType?: number;
}

export interface AisstreamEnv {
  enabled: boolean;
  /** Motivo si está desactivado (para el aviso). */
  reason?: string;
  apiKey?: string;
  idSalt?: string;
}

/** Sin clave o sin sal el adaptador queda desactivado (con motivo) y el arranque no se rompe. */
export function aisstreamConfigFromEnv(env: Record<string, string | undefined>): AisstreamEnv {
  const apiKey = env.AISSTREAM_API_KEY?.trim();
  const idSalt = env.SHIP_ID_SALT?.trim();
  if (!apiKey) return { enabled: false, reason: "falta AISSTREAM_API_KEY" };
  if (!idSalt) {
    return { enabled: false, reason: "falta SHIP_ID_SALT (el MMSI no se expone sin sal)" };
  }
  return { enabled: true, apiKey, idSalt };
}

// ---------- utilidades puras ----------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const smallInt = (v: unknown, max: number): number | undefined => {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};

/** Hash corto estable (12 hex) del MMSI con sal; no reversible sin la sal. */
export function shipId(mmsi: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${mmsi}`).digest("hex").slice(0, 12);
}

/** Espera antes del reintento `attempt` (1 = primero): exponencial con jitter [50 %, 100 %]. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(cap / 2 + (cap / 2) * random());
}

/**
 * `MetaData.time_utc` de aisstream: `2022-12-29 18:22:32.318353 +0000 UTC` (formato no verificado
 * con tráfico real, ver spec). Devuelve epoch ms o undefined si no encaja.
 */
export function parseTimeUtc(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(?:\+0000(?: UTC)?|Z|UTC)?$/.exec(
      v.trim(),
    );
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  if (Number.isNaN(t)) return undefined;
  return t + Math.floor(Number(`0.${m[3] ?? "0"}`) * 1000);
}

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/@+/g, " ").trim(); // AIS rellena con '@'
  return s === "" ? undefined : s.slice(0, 40);
};

const inBox = (lat: number, lon: number): boolean =>
  lat >= BOUNDING_BOX[0][0] &&
  lat <= BOUNDING_BOX[1][0] &&
  lon >= BOUNDING_BOX[0][1] &&
  lon <= BOUNDING_BOX[1][1];

/** Mensaje ya decodificado: actualización parcial de un barco. */
export interface AisUpdate {
  mmsi: string;
  ts: number;
  position?: {
    lat: number;
    lon: number;
    sogKn?: number;
    cog?: number;
    heading?: number;
    navStatus?: number;
  };
  name?: string;
  shipType?: number;
}

/** Puro. Tolera campos ausentes; descarta tipos no suscritos, MMSI inválido y posiciones no válidas. */
export function parseAisMessage(raw: unknown, receivedAt: number): AisUpdate | null {
  if (!isObj(raw) || typeof raw.MessageType !== "string") return null;
  const type = raw.MessageType;
  if (!(MESSAGE_TYPES as readonly string[]).includes(type)) return null;
  const meta = isObj(raw.MetaData) ? raw.MetaData : {};
  const body = isObj(raw.Message) ? raw.Message : {};
  const msg = body[type];
  if (!isObj(msg)) return null;

  const mmsiNum = num(msg.UserID) ?? num(meta.MMSI);
  if (mmsiNum === undefined || !Number.isInteger(mmsiNum)) return null;
  if (mmsiNum < 100_000_000 || mmsiNum > 999_999_999) return null;
  const mmsi = String(mmsiNum);

  let ts = parseTimeUtc(meta.time_utc) ?? receivedAt;
  if (ts > receivedAt + 60_000) ts = receivedAt; // reloj adelantado: no confiar
  const name = cleanName(meta.ShipName) ?? cleanName(msg.Name);

  if (type === "ShipStaticData") {
    const shipType = smallInt(msg.Type, 99);
    return {
      mmsi,
      ts,
      ...(name ? { name } : {}),
      ...(shipType !== undefined ? { shipType } : {}),
    };
  }

  if (msg.Valid === false) return null;
  const lat = num(msg.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
  const lon = num(msg.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
  if (lat === undefined || lon === undefined || lat === 91 || lon === 181) return null;
  if (!inBox(lat, lon)) return null;

  const sog = num(msg.Sog);
  const cog = num(msg.Cog);
  const th = num(msg.TrueHeading);
  const nav = smallInt(msg.NavigationalStatus, 15);
  const shipType = type === "ExtendedClassBPositionReport" ? smallInt(msg.Type, 99) : undefined;
  return {
    mmsi,
    ts,
    position: {
      lat,
      lon,
      ...(sog !== undefined && sog >= 0 && sog < 102.3 ? { sogKn: sog } : {}), // 102.3 = n/d
      ...(cog !== undefined && cog >= 0 && cog < 360 ? { cog } : {}), // 360 = n/d
      ...(th !== undefined && th >= 0 && th < 360 ? { heading: th } : {}), // 511 = n/d
      ...(nav !== undefined ? { navStatus: nav } : {}),
    },
    ...(name ? { name } : {}),
    ...(shipType !== undefined ? { shipType } : {}),
  };
}

/** Puro. `ShipRaw` -> `Entity[]` con id hasheado y `meta` sin MMSI. */
export function parseAisstream(raw: unknown): Entity[] {
  if (!isObj(raw) || !Array.isArray(raw.ships) || typeof raw.salt !== "string" || raw.salt === "") {
    return [];
  }
  const out: Entity[] = [];
  for (const s of raw.ships as unknown[]) {
    if (!isObj(s) || typeof s.mmsi !== "string") continue;
    const lat = num(s.lat);
    const lon = num(s.lon);
    const ts = num(s.ts);
    if (lat === undefined || lon === undefined || ts === undefined || ts <= 0) continue;
    const sog = num(s.sogKn);
    const heading = num(s.heading);
    const cog = num(s.cog);
    // Rumbo: TrueHeading si hay; si no, Cog solo si el barco se mueve (parado, Cog es ruido).
    const dir = heading ?? (cog !== undefined && sog !== undefined && sog >= 0.5 ? cog : undefined);
    const name = typeof s.name === "string" ? s.name : undefined;
    const navStatus = num(s.navStatus);
    const shipType = num(s.shipType);
    const e = EntitySchema.safeParse({
      id: shipId(s.mmsi, raw.salt),
      layer: "ship",
      lon,
      lat,
      ...(dir !== undefined ? { heading: dir } : {}),
      ...(sog !== undefined ? { speed: Math.round(sog * KNOT_MS * 100) / 100 } : {}),
      ts,
      meta: {
        ...(name ? { name } : {}),
        ...(shipType !== undefined ? { shipType } : {}),
        ...(navStatus !== undefined ? { navStatus } : {}),
      },
    });
    if (e.success) out.push(e.data);
  }
  return out;
}

// ---------- colector ----------

export interface AisCollector {
  /** Abre la conexión (idempotente). */
  start(): void;
  /** Cierra y cancela reconexiones. */
  close(): void;
  /** Barcos con posición nueva desde la última llamada; purga los que callaron. */
  drain(): ShipState[];
  /** ms sin señal sana (mensajes del stream); cubre desconexión, clave inválida y socket mudo. */
  downFor(): number;
  readonly connected: boolean;
  readonly size: number;
}

export function createCollector(config: AisstreamConfig): AisCollector {
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  const setTimer = config.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = config.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const createSocket =
    config.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const purgeMs = config.purgeMs ?? DEFAULT_PURGE_MS;
  const silenceMs = config.silenceMs ?? DEFAULT_SILENCE_MS;
  const log = config.logger;

  const ships = new Map<string, ShipState>();
  const emittedTs = new Map<string, number>();
  let socket: WebSocketLike | null = null;
  let retryTimer: unknown;
  let watchdog: unknown;
  let attempts = 0;
  let started = false;
  let connected = false;
  /** Último instante «sano»: arranque o último mensaje que no sea un error del servidor. */
  let healthyAt = 0;

  const clearWatchdog = (): void => {
    if (watchdog !== undefined) clearTimer(watchdog);
    watchdog = undefined;
  };

  const armWatchdog = (): void => {
    clearWatchdog();
    watchdog = setTimer(() => {
      if (!connected || !socket) return;
      log?.warn("aisstream: sin mensajes, se reconecta", { silenceMs });
      socket.close(); // onclose programa la reconexión
    }, silenceMs);
  };

  const apply = (u: AisUpdate): void => {
    const t = now();
    const s: ShipState = ships.get(u.mmsi) ?? { mmsi: u.mmsi, lat: 0, lon: 0, ts: 0, seenAt: t };
    s.seenAt = t;
    if (u.name) s.name = u.name;
    if (u.shipType !== undefined) s.shipType = u.shipType;
    const p = u.position;
    if (p && u.ts >= s.ts) {
      s.lat = p.lat;
      s.lon = p.lon;
      s.ts = u.ts;
      // Estos campos pueden volver a «no disponible»: se reemplazan, no se acumulan.
      delete s.sogKn;
      delete s.cog;
      delete s.heading;
      if (p.sogKn !== undefined) s.sogKn = p.sogKn;
      if (p.cog !== undefined) s.cog = p.cog;
      if (p.heading !== undefined) s.heading = p.heading;
      if (p.navStatus !== undefined) s.navStatus = p.navStatus;
    }
    ships.set(u.mmsi, s);
  };

  const onData = (data: unknown): void => {
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    else return; // Blob u otro: `binaryType = "arraybuffer"` lo evita
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    armWatchdog();
    if (isObj(json) && typeof json.error === "string") {
      log?.warn("aisstream: error del servidor", { error: json.error });
      return; // ni backoff ni salud: p. ej. clave inválida
    }
    healthyAt = now();
    if (isObj(json) && "SubscriptionConfirmation" in json) return;
    attempts = 0; // la conexión da datos: se reinicia el backoff
    const u = parseAisMessage(json, now());
    if (u) apply(u);
  };

  const scheduleReconnect = (): void => {
    if (!started) return;
    attempts++;
    const waitMs = reconnectDelay(attempts, random);
    log?.warn("aisstream: conexión perdida, se reintenta", { attempt: attempts, waitMs });
    retryTimer = setTimer(() => {
      retryTimer = undefined;
      open();
    }, waitMs);
  };

  function open(): void {
    if (!started || socket) return;
    let ws: WebSocketLike;
    try {
      ws = createSocket(STREAM_URL);
    } catch (e) {
      log?.warn("aisstream: no se pudo abrir el socket", {
        error: e instanceof Error ? e.message : String(e),
      });
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      connected = true;
      // Suscripción inmediata (límite: ≤ 3 s tras abrir). Una por conexión (máx. 1/s).
      ws.send(
        JSON.stringify({
          APIKey: config.apiKey,
          BoundingBoxes: [BOUNDING_BOX.map((c) => [...c])],
          FilterMessageTypes: [...MESSAGE_TYPES],
        }),
      );
      armWatchdog();
      log?.info("aisstream: conectado");
    };
    ws.onmessage = (ev) => onData(ev.data);
    ws.onerror = () => {
      // Sin detalle (podría incluir la URL); `onclose` llega siempre después.
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      connected = false;
      clearWatchdog();
      scheduleReconnect();
    };
  }

  return {
    start() {
      if (started) return;
      started = true;
      healthyAt = now();
      open();
    },
    close() {
      started = false;
      if (retryTimer !== undefined) clearTimer(retryTimer);
      retryTimer = undefined;
      clearWatchdog();
      const ws = socket;
      socket = null;
      connected = false;
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {
          // ya cerrado
        }
      }
    },
    drain() {
      const t = now();
      const out: ShipState[] = [];
      for (const [mmsi, s] of ships) {
        if (t - s.seenAt > purgeMs) {
          ships.delete(mmsi);
          emittedTs.delete(mmsi);
        } else if (s.ts > (emittedTs.get(mmsi) ?? 0)) {
          emittedTs.set(mmsi, s.ts);
          out.push({ ...s });
        }
      }
      return out;
    },
    downFor() {
      return now() - healthyAt;
    },
    get connected() {
      return connected;
    },
    get size() {
      return ships.size;
    },
  };
}

// ---------- adaptador ----------

export type AisstreamAdapter = Adapter<Entity> & {
  enabled: true;
  collector: AisCollector;
  close(): void;
};

export function createAisstreamAdapter(config: AisstreamConfig): AisstreamAdapter {
  if (!config.apiKey) throw new Error("aisstream: falta apiKey (AISSTREAM_API_KEY)");
  if (!config.idSalt) throw new Error("aisstream: falta idSalt (SHIP_ID_SALT)");
  const salt = config.idSalt;
  const now = config.now ?? Date.now;
  const downMs = config.downMs ?? DEFAULT_DOWN_MS;
  const collector = createCollector(config);
  return {
    id: "aisstream",
    intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
    enabled: true,
    collector,
    // La conexión se abre en el primer ciclo (no al importar el módulo ni en los tests de registro).
    fetch(): Promise<ShipRaw> {
      collector.start();
      if (collector.downFor() > downMs) {
        return Promise.reject(new Error("aisstream: sin conexión con el stream AIS"));
      }
      return Promise.resolve({ receivedAt: now(), salt, ships: collector.drain() });
    },
    parse: parseAisstream,
    close: () => collector.close(),
  };
}
