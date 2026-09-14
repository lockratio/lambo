#!/usr/bin/env bash
# Rebuild assets/models/car.glb from the purchased package.
#   bash tools/build_model.sh "<package-dir>"
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PKG="${1:-}"
[ -d "$PKG" ] || { echo "usage: $0 <package-dir>"; exit 1; }
RAW="$ROOT/assets/models/car.raw.glb"
OUT="$ROOT/assets/models/car.glb"
"$ROOT/.venv/Scripts/python.exe" "$HERE/build_model.py" "$PKG" "$RAW"
# meshopt + webp, but keep every named mesh (no join / palette / simplify)
"$HERE/node_modules/.bin/gltf-transform" optimize "$RAW" "$OUT" \
  --compress meshopt --meshopt-level high \
  --join false --palette false --simplify false --instance false \
  --texture-compress webp --texture-size 1024
"$HERE/node_modules/.bin/gltf-transform" inspect "$OUT" | head -80
rm -f "$RAW"
ls -la "$OUT"
