import type { RetentionConfig } from "./db/retention.js";

export interface IngestConfig {
  /** Retención de brutos y downsampling a 1/min (M6.1). */
  retention: RetentionConfig;
  databaseUrl: string;
  /** Tiempo máximo de cada intento de fetch+parse. */
  timeoutMs: number;
  /** Intentos por ciclo (1 = sin reintentos). */
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Fallos de ciclo consecutivos a partir de los cuales la fuente está `down`. */
  downAfter: number;
  /** Conexión a la BD (segundos / ms). */
  dbConnectTimeoutS: number;
  dbIdleTimeoutS: number;
  dbMaxLifetimeS: number;
  dbStatementTimeoutMs: number;
  /** Intentos de migración al arrancar (la BD puede levantarse después que la ingesta). */
  migrateAttempts: number;
}

function int(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${name} debe ser un entero >= 1 (recibido "${raw}")`);
  return n;
}

function bool(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["true", "1", "yes"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  throw new Error(`${name} debe ser true o false (recibido "${env[name]}")`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): IngestConfig {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("Falta DATABASE_URL (ver .env.example)");
  const config: IngestConfig = {
    retention: {
      enabled: bool(env, "RETENTION_ENABLED", true),
      rawDays: int(env, "RETENTION_RAW_DAYS", 30),
      intervalMs: int(env, "RETENTION_INTERVAL_MS", 3_600_000),
      statementTimeoutMs: int(env, "RETENTION_STATEMENT_TIMEOUT_MS", 900_000),
    },
    databaseUrl,
    timeoutMs: int(env, "INGEST_TIMEOUT_MS", 15_000),
    maxAttempts: int(env, "INGEST_MAX_ATTEMPTS", 3),
    backoffBaseMs: int(env, "INGEST_BACKOFF_BASE_MS", 1_000),
    backoffMaxMs: int(env, "INGEST_BACKOFF_MAX_MS", 30_000),
    downAfter: int(env, "INGEST_DOWN_AFTER", 3),
    dbConnectTimeoutS: int(env, "DB_CONNECT_TIMEOUT_S", 10),
    dbIdleTimeoutS: int(env, "DB_IDLE_TIMEOUT_S", 30),
    dbMaxLifetimeS: int(env, "DB_MAX_LIFETIME_S", 1800),
    dbStatementTimeoutMs: int(env, "DB_STATEMENT_TIMEOUT_MS", 15_000),
    migrateAttempts: int(env, "INGEST_MIGRATE_ATTEMPTS", 10),
  };
  // Con menos de 7 días, drop_chunks invalidaría un rango que el refresco automático (3 días) vaciaría.
  if (config.retention.rawDays < 7) throw new Error("RETENTION_RAW_DAYS debe ser >= 7");
  if (config.backoffMaxMs < config.backoffBaseMs) {
    throw new Error("INGEST_BACKOFF_MAX_MS no puede ser menor que INGEST_BACKOFF_BASE_MS");
  }
  return config;
}
