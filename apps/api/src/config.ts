export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /** Tras un proxy (Caddy) la IP real viene de `X-Forwarded-For`. Solo activarlo detrás de uno. */
  trustProxy: boolean;
  /** `*` o lista de orígenes permitidos (CORS y, si no es `*`, también el handshake WS). */
  corsOrigins: string[];
  /** Cada cuánto se consulta la BD para calcular deltas (ms). */
  pollMs: number;
  /** Caché del snapshot HTTP (ms), para que un martilleo de GET no se traduzca en consultas. */
  snapshotCacheMs: number;
  /** Antigüedad máxima (ms) de la última lectura para seguir contando como «viva», por tipo. */
  maxAgeMs: { entity: number; station: number; observation: number };
  wsMaxPerIp: number;
  wsPingMs: number;
  /** Datos sin enviar acumulados en un cliente a partir de los cuales se le desconecta. */
  wsMaxBufferedBytes: number;
  /** Una fuente se marca `degraded` si no hay lectura en `factor × intervalo` y `down` en `3 × factor`. */
  healthStaleFactor: number;
  healthCacheMs: number;
  /** Antigüedad máxima (días) del `from` de un replay. Más allá se responde 400. */
  replayMaxAgeDays: number;
  /** Hasta cuántos días atrás hay datos brutos; antes se lee la tabla de 1 muestra/min (M6.1). */
  replayRawDays: number;
  /** Filas máximas leídas por tabla y ventana; superado → 413 (se pide menos capas). */
  replayMaxRows: number;
  /** Tamaño máximo (bytes) de la respuesta MessagePack; superado → 413. */
  replayMaxBytes: number;
  /** Peticiones de replay simultáneas por IP (cabecera de coste: cada una toca la BD). */
  replayMaxPerIp: number;
  /** Caché en memoria (bytes) de ventanas pasadas ya codificadas; 0 la desactiva. */
  replayCacheBytes: number;
  dbConnectTimeoutS: number;
  dbIdleTimeoutS: number;
  dbMaxLifetimeS: number;
  dbStatementTimeoutMs: number;
}

function int(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min = 1,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} debe ser un entero >= ${min} (recibido "${raw}")`);
  return n;
}

function bool(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} debe ser "true" o "false" (recibido "${raw}")`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("Falta DATABASE_URL (ver .env.example)");
  const origins = (env["API_CORS_ORIGINS"] ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    databaseUrl,
    host: env["API_HOST"] || "0.0.0.0",
    port: int(env, "API_PORT", 3000),
    logLevel: env["API_LOG_LEVEL"] || "info",
    trustProxy: bool(env, "API_TRUST_PROXY", false),
    corsOrigins: origins.length > 0 ? origins : ["*"],
    pollMs: int(env, "API_POLL_MS", 2_000, 100),
    snapshotCacheMs: int(env, "API_SNAPSHOT_CACHE_MS", 1_000, 0),
    maxAgeMs: {
      entity: int(env, "API_MAX_AGE_ENTITY_MS", 5 * 60_000),
      station: int(env, "API_MAX_AGE_STATION_MS", 60 * 60_000),
      observation: int(env, "API_MAX_AGE_OBSERVATION_MS", 6 * 60 * 60_000),
    },
    wsMaxPerIp: int(env, "API_WS_MAX_PER_IP", 10),
    wsPingMs: int(env, "API_WS_PING_MS", 30_000, 50),
    wsMaxBufferedBytes: int(env, "API_WS_MAX_BUFFERED_BYTES", 4 * 1024 * 1024),
    healthStaleFactor: int(env, "API_HEALTH_STALE_FACTOR", 3),
    healthCacheMs: int(env, "API_HEALTH_CACHE_MS", 5_000, 0),
    replayMaxAgeDays: int(env, "API_REPLAY_MAX_AGE_DAYS", 365),
    replayRawDays: int(env, "API_REPLAY_RAW_DAYS", 28),
    replayMaxRows: int(env, "API_REPLAY_MAX_ROWS", 200_000, 100),
    replayMaxBytes: int(env, "API_REPLAY_MAX_BYTES", 4 * 1024 * 1024, 1024),
    replayMaxPerIp: int(env, "API_REPLAY_MAX_PER_IP", 4),
    replayCacheBytes: int(env, "API_REPLAY_CACHE_BYTES", 32 * 1024 * 1024, 0),
    dbConnectTimeoutS: int(env, "DB_CONNECT_TIMEOUT_S", 10),
    dbIdleTimeoutS: int(env, "DB_IDLE_TIMEOUT_S", 30),
    dbMaxLifetimeS: int(env, "DB_MAX_LIFETIME_S", 1800),
    dbStatementTimeoutMs: int(env, "DB_STATEMENT_TIMEOUT_MS", 15_000),
  };
}
