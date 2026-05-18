#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
DIST_DIR="$DESKTOP_DIR/dist"

cd "$ROOT_DIR"

if [[ "${CLEAN_BUILD:-1}" != "0" ]]; then
  rm -rf "$DIST_DIR"
fi

npm run dist:mac -w @cloak/desktop

DMG_PATH="$(find "$DIST_DIR" -maxdepth 1 -type f -name "*.dmg" -print | sort | tail -n 1 || true)"

if [[ -z "$DMG_PATH" ]]; then
  echo "Build finished, but no DMG was found in $DIST_DIR" >&2
  exit 1
fi

echo "DMG created: $DMG_PATH"
