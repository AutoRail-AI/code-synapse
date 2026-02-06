#!/usr/bin/env bash
# Setup Zoekt binaries for lexical code search (Hybrid Search Phase 2).
# Creates bin/ and installs zoekt-webserver (and optionally zoekt-git-index) via Go, or prints manual instructions.
#
# Usage: ./scripts/setup-zoekt.sh [project_root]
#   project_root: directory containing bin/ (default: script dir's parent)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BIN_DIR="$PROJECT_ROOT/bin"

echo "Zoekt setup: project_root=$PROJECT_ROOT, bin_dir=$BIN_DIR"

mkdir -p "$BIN_DIR"

# Prefer Go install (Zoekt does not publish pre-built release binaries)
if command -v go >/dev/null 2>&1; then
  echo "Installing Zoekt binaries via Go..."
  GOBIN="$BIN_DIR" go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@latest
  GOBIN="$BIN_DIR" go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest 2>/dev/null || true
  if [ -x "$BIN_DIR/zoekt-webserver" ]; then
    echo "Installed: $BIN_DIR/zoekt-webserver"
  fi
  if [ -x "$BIN_DIR/zoekt-git-index" ]; then
    echo "Installed: $BIN_DIR/zoekt-git-index"
  fi
  if [ ! -x "$BIN_DIR/zoekt-webserver" ]; then
    echo "Warning: zoekt-webserver not found after go install. Ensure Go module can be fetched."
  fi
  exit 0
fi

# No Go: print manual instructions
echo "Go not found. Install Zoekt manually:"
echo "  1. Install Go: https://go.dev/dl/"
echo "  2. Run: GOBIN=$BIN_DIR go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@latest"
echo "  3. Run: GOBIN=$BIN_DIR go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest"
echo ""
echo "Or build from source: https://github.com/sourcegraph/zoekt"
echo "Then place zoekt-webserver (and optionally zoekt-git-index) in: $BIN_DIR"
exit 1
