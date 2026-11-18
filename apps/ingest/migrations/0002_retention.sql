-- Retención y compresión (SPEC: 30 días brutos, luego 1 muestra/min/entidad).
-- Los agregados continuos guardan el último valor de cada minuto y NO tienen política de retención.
-- WITH NO DATA: la creación con datos no puede ir dentro de la transacción de la migración.

CREATE MATERIALIZED VIEW IF NOT EXISTS positions_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', ts) AS bucket,
       id,
       layer,
       last(lon, ts)     AS lon,
       last(lat, ts)     AS lat,
       last(heading, ts) AS heading,
       last(speed, ts)   AS speed
FROM positions
GROUP BY 1, id, layer
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS station_status_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', ts) AS bucket,
       id,
       layer,
       last(lon, ts)   AS lon,
       last(lat, ts)   AS lat,
       last(bikes, ts) AS bikes,
       last(docks, ts) AS docks
FROM station_status
GROUP BY 1, id, layer
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS observations_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', ts) AS bucket,
       station_id,
       metric,
       layer,
       last(value, ts) AS value,
       last(unit, ts)  AS unit
FROM observations
GROUP BY 1, station_id, metric, layer
WITH NO DATA;

SELECT add_continuous_aggregate_policy('positions_1m',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('station_status_1m',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('observations_1m',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Compresión nativa de chunks de más de 2 días.
ALTER TABLE positions SET (timescaledb.compress, timescaledb.compress_segmentby = 'id, layer', timescaledb.compress_orderby = 'ts DESC');
ALTER TABLE station_status SET (timescaledb.compress, timescaledb.compress_segmentby = 'id, layer', timescaledb.compress_orderby = 'ts DESC');
ALTER TABLE observations SET (timescaledb.compress, timescaledb.compress_segmentby = 'station_id, metric, layer', timescaledb.compress_orderby = 'ts DESC');

SELECT add_compression_policy('positions', INTERVAL '2 days', if_not_exists => TRUE);
SELECT add_compression_policy('station_status', INTERVAL '2 days', if_not_exists => TRUE);
SELECT add_compression_policy('observations', INTERVAL '2 days', if_not_exists => TRUE);

-- Retención: se borran los datos brutos de más de 30 días.
SELECT add_retention_policy('positions', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('station_status', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('observations', INTERVAL '30 days', if_not_exists => TRUE);
