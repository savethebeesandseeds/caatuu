#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TOOL_DIR/../.." && pwd)"

MODEL_BASENAME="${MODEL_BASENAME:-caatuu-czech-qwen3-1.7b-003-hard}"
SOURCE_MODEL="${SOURCE_MODEL:-$TOOL_DIR/artifacts/models/$MODEL_BASENAME-q4_k_m.gguf}"
SOURCE_SHA="$SOURCE_MODEL.sha256"
SOURCE_MANIFEST="${SOURCE_MANIFEST:-$TOOL_DIR/artifacts/models/manifest.json}"
TARGET_DIR="${TARGET_DIR:-$ROOT_DIR/apps/caatuu-czech/static/data/models/phone-bench}"

if [ ! -f "$SOURCE_MODEL" ]; then
  echo "Missing model: $SOURCE_MODEL" >&2
  echo "Run scripts/prepare-gguf.sh first." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
target_model="$TARGET_DIR/$(basename "$SOURCE_MODEL")"
if [ ! -f "$target_model" ] || [ "$SOURCE_MODEL" -nt "$target_model" ]; then
  cp "$SOURCE_MODEL" "$TARGET_DIR/"
fi
cp "$SOURCE_SHA" "$TARGET_DIR/"
cp "$SOURCE_MANIFEST" "$TARGET_DIR/"
cp "$TOOL_DIR/scripts/termux-run-caatuu-bench.sh" "$TARGET_DIR/"
cp "$TOOL_DIR/prompts/czech-smoke.txt" "$TARGET_DIR/"

echo "Published phone benchmark files to:"
echo "$TARGET_DIR"
