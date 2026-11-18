#!/bin/bash
# Estado en vivo de la ingesta: source_health + filas grabadas.
#   infra/deploy/scripts/health.sh            # una vez
#   infra/deploy/scripts/health.sh --watch    # refresca cada 5 s (Ctrl+C para salir)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/../docker-compose.yml")

query() {
  "${compose[@]}" exec -T db psql -U pulso -d pulso -P pager=off -c "
SELECT source_id, status, consecutive_failures AS fallos,
       now() - last_success_at AS desde_ultimo_ok, last_latency_ms AS ms,
       rows_written_last AS filas_ult, rows_written_total AS filas_total, rows_rejected_last AS rechaz,
       left(coalesce(last_error, ''), 60) AS ultimo_error
FROM source_health ORDER BY source_id;" -c "
SELECT 'positions' AS tabla, count(*) AS filas, max(ts) AS ultima FROM positions
UNION ALL SELECT 'station_status', count(*), max(ts) FROM station_status
UNION ALL SELECT 'observations', count(*), max(ts) FROM observations;"
}

if [ "${1:-}" = "--watch" ]; then
  while true; do clear; date -u +%FT%TZ; query; sleep 5; done
else
  query
fi
