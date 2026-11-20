#!/usr/bin/env sh
# TimescaleDB local efímera para la puerta de M6 (misma imagen que los tests, ADR-0016).
#   sh apps/ingest/scripts/dev-db.sh        → arranca en 127.0.0.1:55432
#   sh apps/ingest/scripts/dev-db.sh stop   → la para y borra
# DATABASE_URL=postgres://pulso:pulso@127.0.0.1:55432/pulso
set -eu
NAME=pulso-puerta-m6
IMAGE=timescale/timescaledb:2.32.0-pg17
PORT=${PULSO_DEV_DB_PORT:-55432}
if [ "${1:-}" = "stop" ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 0; fi
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_USER=pulso -e POSTGRES_PASSWORD=pulso -e POSTGRES_DB=pulso "$IMAGE" >/dev/null
until docker exec "$NAME" pg_isready -h 127.0.0.1 -U pulso -d pulso >/dev/null 2>&1; do sleep 1; done
sleep 2
echo "DATABASE_URL=postgres://pulso:pulso@127.0.0.1:$PORT/pulso"
