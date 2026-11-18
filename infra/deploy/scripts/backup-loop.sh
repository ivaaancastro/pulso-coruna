#!/bin/sh
# Entrypoint del servicio `backup`: duerme hasta BACKUP_HOUR_UTC (HH:MM) y lanza backup.sh cada día.
# Si un backup falla se registra y se reintenta al día siguiente (el contenedor no muere).
set -u

hhmm="${BACKUP_HOUR_UTC:-03:30}"
case "$hhmm" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) echo "BACKUP_HOUR_UTC debe ser HH:MM (recibido '$hhmm')" >&2; exit 1 ;;
esac

echo "backups diarios a las $hhmm UTC, se conservan ${BACKUP_KEEP_DAYS:-14} días en ${BACKUP_DIR:-/backups}"
while true; do
  now="$(date -u +%s)"
  target="$(date -u -d "$(date -u +%Y-%m-%d) $hhmm:00" +%s)"
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep "$((target - now))"
  sh /scripts/backup.sh || echo "backup FALLIDO ($(date -u +%FT%TZ))" >&2
done
