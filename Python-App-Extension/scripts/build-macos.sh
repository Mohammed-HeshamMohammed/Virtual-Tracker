#!/usr/bin/env bash
# Build Virtual Tracker agent for macOS (PyInstaller onedir .app bundle).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="${VT_API_URL:-https://dashapi.myvirtualtracker.com}"
WEB_URL="${VT_WEB_URL:-https://app.myvirtualtracker.com}"
AUTH_PORT="${VT_AUTH_PORT:-17389}"

echo "Building Virtual Tracker Agent (macOS onedir)..."
echo "  VT_API_URL=$API_URL"
echo "  VT_WEB_URL=$WEB_URL"

python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt pyinstaller

export VT_API_URL="$API_URL"
export VT_WEB_URL="$WEB_URL"
export VT_AUTH_PORT="$AUTH_PORT"

python3 -m PyInstaller vt_agent.spec --noconfirm --clean

OUT="$ROOT/dist/VirtualTrackerAgent"
echo ""
echo "Build complete: $OUT"
echo "Run: $OUT/VirtualTrackerAgent"

echo ""
echo "Manual steps for distribution:"
echo "  1. Code-sign the .app (requires Apple Developer account):"
echo "     codesign --deep --force --sign \"Developer ID Application: YOUR NAME\" dist/VirtualTrackerAgent/VirtualTrackerAgent"
echo "  2. Notarize with notarytool (required for Gatekeeper on other Macs)."
echo "  3. Install LaunchAgent for auto-start:"
echo "     cp installer/com.virtualtracker.agent.plist ~/Library/LaunchAgents/"
echo "     launchctl load ~/Library/LaunchAgents/com.virtualtracker.agent.plist"
