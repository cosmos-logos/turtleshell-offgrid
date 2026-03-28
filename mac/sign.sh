#!/bin/bash
# =============================================================
# TurtleShell.ai — Sign & Notarize Script
# Signs the unsigned .pkg and submits to Apple for notarization
# Requires: Developer ID Installer cert in Keychain
#           App-specific password in .build-config
# =============================================================

set -euo pipefail

# Load config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.build-config"

VERSION="${VERSION:-1.7.0}"
PKG_NAME="${PKG_NAME:-TurtleShell}"
BUILD_DIR="$SCRIPT_DIR/build"

UNSIGNED="$BUILD_DIR/${PKG_NAME}-${VERSION}-unsigned.pkg"
SIGNED="$BUILD_DIR/${PKG_NAME}-${VERSION}.pkg"

echo "⬥ TurtleShell.ai — Sign & Notarize"
echo "⬥ Identity: $INSTALLER_IDENTITY"
echo "⬥ Team ID:  $TEAM_ID"
echo "⬥ Input:    $UNSIGNED"
echo "⬥ Output:   $SIGNED"
echo ""

# Verify unsigned pkg exists
[ -f "$UNSIGNED" ] || {
  echo "✗ Unsigned package not found: $UNSIGNED"
  echo "  Run ./build.sh first"
  exit 1
}

# ── STEP 1 — SIGN ─────────────────────────────────────────────
echo "⬥ Step 1/4 — Signing package..."
productsign \
  --sign "$INSTALLER_IDENTITY" \
  "$UNSIGNED" \
  "$SIGNED"

echo "⬥ Signed: $SIGNED"
echo ""

# ── STEP 2 — VERIFY SIGNATURE ─────────────────────────────────
echo "⬥ Step 2/4 — Verifying signature..."
pkgutil --check-signature "$SIGNED"
echo ""

# ── STEP 3 — NOTARIZE ─────────────────────────────────────────
echo "⬥ Step 3/4 — Submitting to Apple for notarization..."
echo "⬥ This takes 2–5 minutes. Do not close this terminal."
echo ""

xcrun notarytool submit "$SIGNED" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_SPECIFIC_PASSWORD" \
  --wait \
  --output-format plist \
  | tee "$BUILD_DIR/notarization-result.plist"

echo ""

# Check notarization result
NOTARY_STATUS=$(plutil -extract "status" raw \
  "$BUILD_DIR/notarization-result.plist" 2>/dev/null || echo "unknown")

if [ "$NOTARY_STATUS" != "Accepted" ]; then
  echo "✗ Notarization failed. Status: $NOTARY_STATUS"
  echo ""
  echo "⬥ Fetching detailed log..."
  SUBMISSION_ID=$(plutil -extract "id" raw \
    "$BUILD_DIR/notarization-result.plist" 2>/dev/null || echo "")
  if [ -n "$SUBMISSION_ID" ]; then
    xcrun notarytool log "$SUBMISSION_ID" \
      --apple-id "$APPLE_ID" \
      --team-id "$TEAM_ID" \
      --password "$APP_SPECIFIC_PASSWORD"
  fi
  exit 1
fi

echo "✓ Notarization accepted"
echo ""

# ── STEP 4 — STAPLE ───────────────────────────────────────────
echo "⬥ Step 4/4 — Stapling notarization ticket..."
xcrun stapler staple "$SIGNED"
echo ""

# ── FINAL VERIFICATION ────────────────────────────────────────
echo "⬥ Final verification..."
spctl --assess --verbose --type install "$SIGNED"
echo ""

# Get file size
SIZE=$(du -sh "$SIGNED" | cut -f1)

echo "⬥ ============================================"
echo "⬥ SUCCESS — Package is signed and notarized"
echo "⬥ File:    $SIGNED"
echo "⬥ Size:    $SIZE"
echo "⬥ Status:  Accepted by Apple"
echo "⬥ ============================================"
echo ""
echo "⬥ Ready to upload to turtleshell.ai/download/"
echo "⬥ Run Phase 7 (upload + download page) next."
