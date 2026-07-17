#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODEL_KEY="${1:-${MODEL_KEY:-}}"
CONFIG_VENV_DIR="${CONFIG_VENV_DIR:-/tmp/caatuu-phone-bench-config-venv}"

if [ -n "$MODEL_KEY" ]; then
  eval "$(python3 "$SCRIPT_DIR/resolve-model-config.py" "$MODEL_KEY")"
else
  eval "$(python3 "$SCRIPT_DIR/resolve-model-config.py")"
fi

echo "Preparing $MODEL_LABEL"
echo "Model key: $MODEL_KEY"
echo "Source: $MODEL_SOURCE_TYPE $MODEL_REPO_ID"
echo "HF dir: $MODEL_HF_DIR"
echo "Artifacts: $OUT_DIR"

if [ "$MODEL_SOURCE_TYPE" = "hf_snapshot" ] && [ ! -f "$MODEL_HF_DIR/config.json" ]; then
  python3 -m venv "$CONFIG_VENV_DIR"
  # shellcheck source=/dev/null
  . "$CONFIG_VENV_DIR/bin/activate"
  python -m pip install --upgrade pip wheel setuptools
  python -m pip install "huggingface_hub>=0.24"
  python "$SCRIPT_DIR/download-hf-snapshot.py" \
    --repo-id "$MODEL_REPO_ID" \
    --out-dir "$MODEL_HF_DIR"
fi

if [ ! -f "$MODEL_HF_DIR/config.json" ]; then
  echo "Missing Hugging Face model directory: $MODEL_HF_DIR" >&2
  exit 1
fi

bash "$SCRIPT_DIR/prepare-gguf.sh"
