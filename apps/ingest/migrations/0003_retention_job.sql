-- M6.1: la retención de brutos la hace el job de la ingesta (src/db/retention.ts), no una política
-- de Timescale: así un chunk solo se borra DESPUÉS de haber refrescado su agregado `*_1m`.
SELECT remove_retention_policy('positions', if_exists => TRUE);
SELECT remove_retention_policy('station_status', if_exists => TRUE);
SELECT remove_retention_policy('observations', if_exists => TRUE);

-- Estado de la última pasada por tabla bruta (salud de la retención; una fila por tabla).
CREATE TABLE IF NOT EXISTS retention_status (
  target          text        PRIMARY KEY,
  last_run_at     timestamptz NOT NULL,
  last_success_at timestamptz,
  last_error      text,
  cutoff          timestamptz,
  dropped_last    integer     NOT NULL DEFAULT 0,
  dropped_total   bigint      NOT NULL DEFAULT 0
);
