#!/usr/bin/env bash
# Regenera public/fonts/archivo-latin-wdth-normal.woff2 (≈ 39,8 KB) desde el woff2 latín de
# @fontsource-variable/archivo 5.3.0 (archivo-latin-wdth-normal.woff2). No se ejecuta en CI.
# Uso: apps/web/scripts/subset-font.sh <origen.woff2> <destino.woff2>
set -euo pipefail
SRC="${1:?origen.woff2}"; OUT="${2:?destino.woff2}"
VENV="$(mktemp -d)"; trap 'rm -rf "$VENV"' EXIT
python3 -m venv "$VENV" && "$VENV/bin/pip" install -q fonttools==4.68.0 brotli==1.2.1
# es/gl/en: latín básico + Latin-1 (á é í ó ú ü ñ ¿ ¡ «» º ª) + puntuación tipográfica y €. latin-ext no hace falta.
U="U+0020-007E,U+00A0,U+00A1,U+00AB,U+00B0,U+00B7,U+00BB,U+00BF,U+00C0-00FF,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+20AC,U+2212,U+00D7"
"$VENV/bin/pyftsubset" "$SRC" --unicodes="$U" --flavor=woff2 --layout-features="kern,tnum" --no-hinting --output-file="$VENV/s.woff2"
# Ejes wght y wdth conservados, acotados al rango usado en docs/design (wght 300–600, wdth 90–125).
"$VENV/bin/fonttools" varLib.instancer "$VENV/s.woff2" wght=300:600 wdth=90:125 -o "$OUT"
