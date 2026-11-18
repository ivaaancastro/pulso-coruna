#!/bin/sh
# Un backup lógico de la BD: pg_dump formato custom (comprimido) + rotación.
# Corre dentro del servicio `backup` (PGHOST/PGUSER/PGDATABASE/PGPASSWORD vienen del entorno).
# Manual: docker compose -f infra/deploy/docker-compose.yml exec backup sh /scripts/backup.sh
set -eu

dir="${BACKUP_DIR:-/backups}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$dir/pulso-$stamp.dump"
tmp="$dir/.pulso-$stamp.dump.tmp"

mkdir -p "$dir"
trap 'rm -f "$tmp"' EXIT

pg_dump --format=custom --compress=6 --no-owner --file="$tmp"
# Un dump que no se puede listar está corrupto: no lo damos por bueno ni rotamos nada.
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$final"
echo "backup ok: $final ($(wc -c <"$final") bytes)"

# Rotación: borra solo nuestros ficheros y solo tras un backup correcto.
find "$dir" -maxdepth 1 -name 'pulso-*.dump' -mtime "+$keep_days" -print -delete
