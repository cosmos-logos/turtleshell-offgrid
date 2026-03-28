#!/bin/bash
# =============================================================
# TurtleShell.ai — Package Build Script
# Builds unsigned .pkg for local testing
# Run sign.sh after this to sign and notarize for distribution
# =============================================================

set -euo pipefail

# Load config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.build-config"

echo "⬥ TurtleShell.ai Package Builder"
echo "⬥ Version: $VERSION"
echo "⬥ Identifier: $IDENTIFIER"
echo ""

# Paths
MAC_DIR="$SCRIPT_DIR"
BUILD_DIR="$MAC_DIR/build"
COMPONENT_PKG="$BUILD_DIR/${PKG_NAME}-${VERSION}-component.pkg"
UNSIGNED_PKG="$BUILD_DIR/${PKG_NAME}-${VERSION}-unsigned.pkg"

# Clean previous build
rm -f "$COMPONENT_PKG" "$UNSIGNED_PKG"
mkdir -p "$BUILD_DIR"

echo "⬥ Step 1/2 — Building component package..."
pkgbuild \
  --root "$MAC_DIR/payload" \
  --scripts "$MAC_DIR/scripts" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/Library/Application Support/TurtleShell" \
  "$COMPONENT_PKG"

echo "⬥ Component package: $COMPONENT_PKG"
echo ""

echo "⬥ Step 2/2 — Building product archive with wizard..."
productbuild \
  --distribution "$MAC_DIR/Distribution.xml" \
  --resources "$MAC_DIR/resources" \
  --package-path "$BUILD_DIR" \
  "$UNSIGNED_PKG"

echo ""
echo "⬥ ============================================"
echo "⬥ Build complete"
echo "⬥ Output: $UNSIGNED_PKG"
echo "⬥ Size: $(du -sh "$UNSIGNED_PKG" | cut -f1)"
echo "⬥ ============================================"
echo ""
echo "⬥ To test: open $UNSIGNED_PKG"
echo "⬥ To ship: run ./sign.sh"
