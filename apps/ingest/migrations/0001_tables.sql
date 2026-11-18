-- Tablas base. Tiempo en timestamptz (UTC); el código traduce epoch ms <-> Date.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Móviles (Entity): bus, ship, plane, train.
CREATE TABLE IF NOT EXISTS positions (
  id      text             NOT NULL,
  ts      timestamptz      NOT NULL,
  layer   text             NOT NULL,
  lon     double precision NOT NULL,
  lat     double precision NOT NULL,
  heading double precision,
  speed   double precision,
  meta    jsonb,
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('positions', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS positions_layer_ts_idx ON positions (layer, ts DESC);

-- Estaciones de bicis (StationStatus).
CREATE TABLE IF NOT EXISTS station_status (
  id    text             NOT NULL,
  ts    timestamptz      NOT NULL,
  layer text             NOT NULL,
  lon   double precision NOT NULL,
  lat   double precision NOT NULL,
  bikes integer          NOT NULL,
  docks integer          NOT NULL,
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('station_status', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Meteo, aire, mar (Observation). Identidad: station_id + metric.
CREATE TABLE IF NOT EXISTS observations (
  station_id text             NOT NULL,
  metric     text             NOT NULL,
  ts         timestamptz      NOT NULL,
  layer      text             NOT NULL,
  value      double precision NOT NULL,
  unit       text             NOT NULL,
  PRIMARY KEY (station_id, metric, ts)
);
SELECT create_hypertable('observations', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Salud por fuente: una fila por adaptador, actualizada en cada ciclo.
CREATE TABLE IF NOT EXISTS source_health (
  source_id            text        PRIMARY KEY,
  status               text        NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
  interval_ms          integer     NOT NULL,
  last_success_at      timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  consecutive_failures integer     NOT NULL DEFAULT 0,
  last_latency_ms      integer,
  rows_written_last    integer     NOT NULL DEFAULT 0,
  rows_written_total   bigint      NOT NULL DEFAULT 0,
  rows_rejected_last   integer     NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL
);
