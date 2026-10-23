#!/bin/bash
# Install JobMagnet.app for Spotlight / Dock. Removes the old Jobs.app hit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
DEST="$HOME/Applications/JobMagnet.app"
OLD="/Applications/Jobs.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Missing Electron.app — run npm install first." >&2
  exit 1
fi

mkdir -p "$HOME/Applications"
echo "Installing $DEST"
rm -rf "$DEST"
ditto "$ELECTRON_APP" "$DEST"
rm -rf "$DEST/Contents/Resources/app"
ln -sfn "$ROOT" "$DEST/Contents/Resources/app"

PLIST="$DEST/Contents/Info.plist"
plutil -replace CFBundleName -string JobMagnet "$PLIST"
plutil -replace CFBundleDisplayName -string JobMagnet "$PLIST"
plutil -replace CFBundleIdentifier -string com.chas.jobmagnet "$PLIST"

xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST" >/dev/null
xattr -w com.apple.metadata:kMDItemKeywords '("job","jobmagnet","apply")' "$DEST" 2>/dev/null || true

if [[ -e "$OLD" ]]; then
  echo "Removing $OLD from disk and Launch Services"
  "$LSREGISTER" -u "$OLD" 2>/dev/null || true
  rm -rf "$OLD"
fi

"$LSREGISTER" -f "$DEST" 2>/dev/null || true
mdimport "$DEST" 2>/dev/null || true

echo "Done. Cmd-Space → job → Enter should hit JobMagnet."
