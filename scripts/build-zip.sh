#!/usr/bin/env bash
# Builds the installable extension zip (only the files Chrome needs).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="x-reels-desktop-${VERSION}.zip"
rm -f "$OUT"
STAGE=$(mktemp -d)
DIR="$STAGE/x-reels-desktop"
mkdir -p "$DIR"
cp -r manifest.json background.js shims.js page-shim.js fx.js controls.js popup icons LICENSE "$DIR/"
(cd "$STAGE" && zip -qr - x-reels-desktop) > "$OUT"
rm -rf "$STAGE"
echo "$OUT"
