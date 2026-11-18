export interface IngestConfig {
  databaseUrl: string;
  /** Tiempo máximo de cada intento de fetch+parse. */
  timeoutMs: number;
  /** Intentos por ciclo (1 = sin reintentos). */
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Fallos de ciclo consecutivos a partir de los cuales la fuente está `down`. */
  downAfter: number;
}

function int(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${name} debe ser un entero >= 1 (recibido "${raw}")`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): IngestConfig {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("Falta DATABASE_URL (ver .env.example)");
  const config: IngestConfig = {
    databaseUrl,
    timeoutMs: int(env, "INGEST_TIMEOUT_MS", 15_000),
    maxAttempts: int(env, "INGEST_MAX_ATTEMPTS", 3),
    backoffBaseMs: int(env, "INGEST_BACKOFF_BASE_MS", 1_000),
    backoffMaxMs: int(env, "INGEST_BACKOFF_MAX_MS", 30_000),
    downAfter: int(env, "INGEST_DOWN_AFTER", 3),
  };
  if (config.backoffMaxMs < config.backoffBaseMs) {
    throw new Error("INGEST_BACKOFF_MAX_MS no puede ser menor que INGEST_BACKOFF_BASE_MS");
  }
  return config;
}
