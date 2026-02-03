#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT_DIR/sources/main.ts"
DIST_ROOT="$ROOT_DIR/dist/platforms"

declare -a TARGETS=(
  "linux-x64:bun-linux-x64:bee"
  "linux-arm64:bun-linux-arm64:bee"
  "mac-x64:bun-darwin-x64:bee"
  "mac-arm64:bun-darwin-arm64:bee"
  "windows-x64:bun-windows-x64:bee.exe"
  "windows-arm64:bun-windows-arm64:bee.exe"
)

for target in "${TARGETS[@]}"; do
  IFS=":" read -r NAME BUN_TARGET OUT_NAME <<< "$target"
  OUT_DIR="$DIST_ROOT/$NAME"
  mkdir -p "$OUT_DIR"
  OUTFILE="$OUT_DIR/$OUT_NAME"

  echo ""
  echo "Building $NAME -> $OUTFILE"
  bun build "$ENTRY" --compile "--target=$BUN_TARGET" --outfile "$OUTFILE"
done
