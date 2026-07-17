#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TOOL_DIR/../.." && pwd)"

MODEL_KEY="${1:-${MODEL_KEY:-}}"

if [ -n "$MODEL_KEY" ]; then
  eval "$(python3 "$SCRIPT_DIR/resolve-model-config.py" "$MODEL_KEY")"
else
  eval "$(python3 "$SCRIPT_DIR/resolve-model-config.py")"
fi

SOURCE_MODEL="${SOURCE_MODEL:-$OUT_DIR/$MODEL_BASENAME-q4_k_m.gguf}"
SOURCE_SHA="$SOURCE_MODEL.sha256"
SOURCE_MANIFEST="${SOURCE_MANIFEST:-$OUT_DIR/manifest.json}"
TARGET_DIR="${TARGET_DIR:-$ROOT_DIR/apps/languages/czech/static/data/models/phone-bench}"

if [ ! -f "$SOURCE_MODEL" ]; then
  echo "Missing model: $SOURCE_MODEL" >&2
  echo "Run scripts/prepare-model.sh ${MODEL_KEY:-<model-key>} first." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
target_model="$TARGET_DIR/$(basename "$SOURCE_MODEL")"
if [ ! -f "$target_model" ] || [ "$SOURCE_MODEL" -nt "$target_model" ]; then
  cp "$SOURCE_MODEL" "$TARGET_DIR/"
fi
cp "$SOURCE_SHA" "$TARGET_DIR/"
cp "$SOURCE_MANIFEST" "$TARGET_DIR/$MODEL_KEY.manifest.json"
if [ "$MODEL_KEY" = "$DEFAULT_MODEL_KEY" ]; then
  cp "$SOURCE_MANIFEST" "$TARGET_DIR/manifest.json"
fi
cp "$TOOL_DIR/scripts/termux-run-caatuu-bench.sh" "$TARGET_DIR/"
cp "$TOOL_DIR/scripts/termux-chat-caatuu.sh" "$TARGET_DIR/"
cp "$TOOL_DIR/prompts/czech-smoke.txt" "$TARGET_DIR/"
python3 "$SCRIPT_DIR/write-static-model-catalog.py" --target-dir "$TARGET_DIR"

echo "Published phone benchmark files to:"
echo "$TARGET_DIR"
