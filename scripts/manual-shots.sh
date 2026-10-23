#!/bin/sh
# Makes the manual's screenshots (docs/dev/manual.md): one run of tests/manual, then each picture is squeezed to 64 colours
# (the screens are flat colour, so nothing is lost and a file is about a quarter of its size). Needs ImageMagick for the squeeze;
# without it the pictures are kept as they came, only larger.
set -e
cd "$(dirname "$0")/.."
OUT="${MANUAL_SHOTS_DIR:-public/manual/shots}"
export MANUAL_SHOTS_DIR="$OUT"
npx playwright test --config playwright.manual.config.ts "$@"
if command -v magick >/dev/null 2>&1; then
  find "$OUT" -name '*.png' | while read -r f; do magick "$f" -colors 64 -dither None -define png:compression-level=9 -strip "PNG8:$f"; done
else
  echo "ImageMagick (magick) not found: the pictures were not squeezed." >&2
fi
