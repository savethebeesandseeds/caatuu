#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TOOL_DIR/../.." && pwd)"

RUN_ID="${RUN_ID:-qwen3-1.7b-lora-003-hard}"
MODEL_KEY="${MODEL_KEY:-$RUN_ID}"
MODEL_LABEL="${MODEL_LABEL:-$RUN_ID}"
MODEL_SOURCE_TYPE="${MODEL_SOURCE_TYPE:-local_hf}"
MODEL_REPO_ID="${MODEL_REPO_ID:-}"
MODEL_LICENSE="${MODEL_LICENSE:-}"
MODEL_NOTES_JSON="${MODEL_NOTES_JSON:-[]}"
MODEL_HF_DIR="${MODEL_HF_DIR:-$ROOT_DIR/tools/caatuu-cz-ml/data/models/czech-finetuned/exports/$RUN_ID/merged-hf}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$TOOL_DIR/vendor/llama.cpp}"
PATCH_DIR="${PATCH_DIR:-$TOOL_DIR/patches}"
OUT_DIR="${OUT_DIR:-$TOOL_DIR/artifacts/models}"
MODEL_BASENAME="${MODEL_BASENAME:-caatuu-czech-qwen3-1.7b-003-hard}"
MODEL_QUANTIZATION="${MODEL_QUANTIZATION:-Q4_K_M}"
F16_GGUF="$OUT_DIR/$MODEL_BASENAME-f16.gguf"
Q4_GGUF="$OUT_DIR/$MODEL_BASENAME-q4_k_m.gguf"
VENV_DIR="${VENV_DIR:-/tmp/caatuu-phone-bench-llama-venv}"
FORCE_REBUILD_GGUF="${FORCE_REBUILD_GGUF:-0}"

if [ ! -f "$MODEL_HF_DIR/config.json" ]; then
  echo "Missing merged Hugging Face model: $MODEL_HF_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$TOOL_DIR/vendor"

if [ ! -d "$LLAMA_CPP_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP_DIR"
fi

if [ -d "$PATCH_DIR" ]; then
  for patch_file in "$PATCH_DIR"/*.patch; do
    [ -f "$patch_file" ] || continue
    if git -C "$LLAMA_CPP_DIR" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
      echo "llama.cpp patch already applied: $(basename "$patch_file")"
    else
      git -C "$LLAMA_CPP_DIR" apply "$patch_file"
      echo "Applied llama.cpp patch: $(basename "$patch_file")"
    fi
  done
fi

cmake -S "$LLAMA_CPP_DIR" -B "$LLAMA_CPP_DIR/build-host" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF
cmake --build "$LLAMA_CPP_DIR/build-host" --config Release -j "$(nproc)"

python3 -m venv "$VENV_DIR"
# shellcheck source=/dev/null
. "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip wheel setuptools
python -m pip install -r "$LLAMA_CPP_DIR/requirements/requirements-convert_hf_to_gguf.txt"

if [ "$FORCE_REBUILD_GGUF" = "1" ]; then
  rm -f "$F16_GGUF" "$Q4_GGUF"
fi

if [ ! -f "$F16_GGUF" ]; then
  python "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" "$MODEL_HF_DIR" \
    --outfile "$F16_GGUF" \
    --outtype f16
fi

QUANTIZE_BIN="$LLAMA_CPP_DIR/build-host/bin/llama-quantize"
if [ ! -x "$QUANTIZE_BIN" ]; then
  echo "Missing llama-quantize at $QUANTIZE_BIN" >&2
  exit 1
fi

if [ ! -f "$Q4_GGUF" ]; then
  "$QUANTIZE_BIN" "$F16_GGUF" "$Q4_GGUF" "$MODEL_QUANTIZATION"
fi

bytes="$(stat -c '%s' "$Q4_GGUF")"
sha="$(sha256sum "$Q4_GGUF" | cut -d ' ' -f 1)"
printf '%s  %s\n' "$sha" "$(basename "$Q4_GGUF")" > "$Q4_GGUF.sha256"

cat > "$OUT_DIR/manifest.json" <<EOF
{
  "version": 1,
  "model_key": "$MODEL_KEY",
  "label": "$MODEL_LABEL",
  "run_id": "$RUN_ID",
  "source_type": "$MODEL_SOURCE_TYPE",
  "repo_id": "$MODEL_REPO_ID",
  "license": "$MODEL_LICENSE",
  "runtime": "llama.cpp",
  "format": "gguf",
  "quantization": "$MODEL_QUANTIZATION",
  "source_model": "$MODEL_HF_DIR",
  "model_file": "$(basename "$Q4_GGUF")",
  "bytes": $bytes,
  "sha256": "$sha",
  "notes": $MODEL_NOTES_JSON
}
EOF

echo "Ready: $Q4_GGUF"
echo "SHA256: $sha"
