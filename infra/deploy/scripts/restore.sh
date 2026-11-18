#!/bin/bash
# Restaura un backup (.dump de backup.sh) en la BD del servicio `db`.
#   infra/deploy/scripts/restore.sh [--yes] [--db NOMBRE] ruta/pulso-XXXX.dump
# Por defecto REEMPLAZA la BD `pulso` (para la ingesta, recrea la BD, restaura y vuelve a arrancar).
# Con --db otra_bd restaura en una BD aparte sin tocar la real (útil para verificar un backup).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/../docker-compose.yml")
target=pulso
yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1; shift ;;
    --db) target="$2"; shift 2 ;;
    -*) echo "opción desconocida: $1" >&2; exit 2 ;;
    *) file="$1"; shift ;;
  esac
done
[ -n "${file:-}" ] && [ -f "$file" ] || { echo "uso: $0 [--yes] [--db NOMBRE] fichero.dump" >&2; exit 2; }
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "nombre de BD no válido: $target" >&2; exit 2; }

if [ "$yes" -ne 1 ]; then
  echo "Se BORRARÁ la BD '$target' y se restaurará desde $file."
  read -r -p "Escribe 'si' para continuar: " ans
  [ "$ans" = "si" ] || { echo "cancelado"; exit 1; }
fi

psql_db=("${compose[@]}" exec -T db psql -U pulso -v ON_ERROR_STOP=1 -q)

echo "-> db sana"
"${compose[@]}" up -d --wait db
if [ "$target" = pulso ]; then
  echo "-> parando ingest"
  "${compose[@]}" stop ingest
fi

echo "-> recreando la BD '$target'"
"${psql_db[@]}" -d postgres <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $target;
CREATE DATABASE $target;
SQL
"${psql_db[@]}" -d "$target" -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();" >/dev/null

echo "-> restaurando"
"${compose[@]}" cp "$file" db:/tmp/restore.dump
# La extensión ya la creamos nosotros: se quita del índice para no chocar con ella.
"${compose[@]}" exec -T db sh -c "
  pg_restore --list /tmp/restore.dump | grep -v ' EXTENSION ' > /tmp/restore.list &&
  pg_restore -U pulso -d $target --no-owner --exit-on-error -L /tmp/restore.list /tmp/restore.dump;
  rc=\$?; rm -f /tmp/restore.dump /tmp/restore.list; exit \$rc"
"${psql_db[@]}" -d "$target" -c "SELECT timescaledb_post_restore();" >/dev/null

if [ "$target" = pulso ]; then
  echo "-> arrancando ingest"
  "${compose[@]}" up -d ingest
fi
echo "restauración completada en '$target'"
