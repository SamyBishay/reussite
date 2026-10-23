#!/bin/bash
# The Dove's cut-outs and the app's icons, from the two photographs (see docs/dev/dove.md).
#   scripts/dove/build.sh DARK.png LIGHT.png
# Needs ImageMagick 7 (with WebP) and a Python with numpy, scipy, opencv-python-headless (and, for smaller
# icons, imagequant and pillow), e.g. a venv: PY=/path/to/venv/bin/python scripts/dove/build.sh …
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 DARK.png LIGHT.png" >&2; exit 2; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PY=${PY:-python3}
CUT=$(mktemp -d)
trap 'rm -rf "$CUT"' EXIT
"$PY" -I "$ROOT/scripts/dove/cutouts.py" "$1" "$2" "$CUT"
"$PY" -I "$ROOT/scripts/dove/icons.py" "$CUT" "$ROOT/public/icons"
OUT="$ROOT/src/assets/dove"
mkdir -p "$OUT"
# The celebration's pieces, at the photographs' own resolution.
webp() { magick "$CUT/$1.png" ${3:+-resize "$3"} -define webp:alpha-quality=100 -define webp:method=6 -quality "$2" "$OUT/$1.webp"; }
webp heart-dark 84
webp heart-light 84
webp knight 88
webp dragon 86
webp disc 82
webp wreath 86
# The onboarding mark: each heart at 3 x 72 px.
magick "$CUT/heart-dark.png" -resize x216 -define webp:alpha-quality=100 -quality 86 "$OUT/mark-dark.webp"
magick "$CUT/heart-light.png" -resize x216 -define webp:alpha-quality=100 -quality 86 "$OUT/mark-light.webp"
ls -l "$OUT" "$ROOT/public/icons"
