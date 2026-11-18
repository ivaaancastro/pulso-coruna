#!/usr/bin/env bash
# Genera infra/tiles/.work/coruna.pmtiles (OSM -> PMTiles, esquema OpenMapTiles) con Planetiler.
# Reproducible: versiones y extracto fijados abajo. Todo lo descargado queda en .work/ (ignorado por git).
set -euo pipefail

PLANETILER_VERSION="v0.10.2"
PLANETILER_SHA256="f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d"
# Extracto diario de Geofabrik (fijado; los "-latest" cambian). Fecha: 2026-11-17.
OSM_URL="https://download.geofabrik.de/europe/spain/galicia-261117.osm.pbf"
# lon_min,lat_min,lon_max,lat_max: bahía, península, Oleiros, Arteixo, Sada/Bergondo.
BOUNDS="-8.58,43.27,-8.25,43.45"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$HERE/.work"
JAR="$WORK/planetiler.jar"
PBF="$WORK/sources/galicia-261117.osm.pbf"
OUT="${1:-$WORK/coruna.pmtiles}"
mkdir -p "$WORK/sources" "$WORK/tmp"

sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

if [ ! -f "$JAR" ]; then
  curl -fL -o "$JAR" "https://github.com/onthegomap/planetiler/releases/download/${PLANETILER_VERSION}/planetiler.jar"
fi
[ "$(sha256 "$JAR")" = "$PLANETILER_SHA256" ] || { echo "SHA-256 de planetiler.jar no coincide" >&2; exit 1; }

[ -f "$PBF" ] || curl -fL -o "$PBF" "$OSM_URL"

# --download solo trae lo auxiliar (water-polygons, natural_earth, lake_centerline: ~1,4 GB, una vez).
java -Xmx3g -jar "$JAR" openmaptiles \
  --download --download_dir="$WORK/sources" --tmpdir="$WORK/tmp" \
  --osm-path="$PBF" --bounds="$BOUNDS" \
  --minzoom=0 --maxzoom=14 \
  --nodemap_type=sortedtable --storage=ram \
  --output="$OUT" --force

echo "OK: $OUT ($(du -h "$OUT" | cut -f1))"
