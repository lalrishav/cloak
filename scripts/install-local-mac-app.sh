#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/apps/desktop/dist"
INSTALL_DIR="${CUE_INSTALL_DIR:-/Applications}"
APP_NAME="Cue.app"
TARGET_APP="$INSTALL_DIR/$APP_NAME"

find_app() {
  find "$DIST_DIR" -maxdepth 2 -type d -name "$APP_NAME" -print 2>/dev/null | sort | tail -n 1 || true
}

APP_PATH="$(find_app)"

if [[ -z "$APP_PATH" ]]; then
  "$ROOT_DIR/scripts/build-mac-dmg.sh"
  APP_PATH="$(find_app)"
fi

if [[ -z "$APP_PATH" ]]; then
  echo "No $APP_NAME bundle was found in $DIST_DIR" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"

for existing_app in "$HOME/Applications/$APP_NAME" "/Applications/$APP_NAME"; do
  if [[ -e "$existing_app" ]]; then
    echo "Removing existing $existing_app"
    if ! rm -rf "$existing_app"; then
      echo "Could not remove $existing_app. Close Cue if it is running, then retry." >&2
      exit 1
    fi
  fi
done

ditto "$APP_PATH" "$TARGET_APP"

echo "Installed $APP_NAME to $TARGET_APP"
