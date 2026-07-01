#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TOOL_DIR/../.." && pwd)"

RUN_ID="${RUN_ID:-qwen3-1.7b-lora-003-hard}"
MODEL_HF_DIR="${MODEL_HF_DIR:-$ROOT_DIR/tools/caatuu-cz-ml/data/models/czech-finetuned/exports/$RUN_ID/merged-hf}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$TOOL_DIR/vendor/llama.cpp}"
OUT_DIR="${OUT_DIR:-$TOOL_DIR/artifacts/models}"
MODEL_BASENAME="${MODEL_BASENAME:-caatuu-czech-qwen3-1.7b-003-hard}"
F16_GGUF="$OUT_DIR/$MODEL_BASENAME-f16.gguf"
Q4_GGUF="$OUT_DIR/$MODEL_BASENAME-q4_k_m.gguf"
VENV_DIR="${VENV_DIR:-/tmp/caatuu-phone-bench-llama-venv}"

if [ ! -f "$MODEL_HF_DIR/config.json" ]; then
  echo "Missing merged Hugging Face model: $MODEL_HF_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$TOOL_DIR/vendor"

if [ ! -d "$LLAMA_CPP_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP_DIR"
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
  "$QUANTIZE_BIN" "$F16_GGUF" "$Q4_GGUF" Q4_K_M
fi

bytes="$(stat -c '%s' "$Q4_GGUF")"
sha="$(sha256sum "$Q4_GGUF" | cut -d ' ' -f 1)"
printf '%s  %s\n' "$sha" "$(basename "$Q4_GGUF")" > "$Q4_GGUF.sha256"

cat > "$OUT_DIR/manifest.json" <<EOF
{
  "version": 1,
  "run_id": "$RUN_ID",
  "runtime": "llama.cpp",
  "format": "gguf",
  "quantization": "Q4_K_M",
  "source_model": "$MODEL_HF_DIR",
  "model_file": "$(basename "$Q4_GGUF")",
  "bytes": $bytes,
  "sha256": "$sha"
}
EOF

echo "Ready: $Q4_GGUF"
echo "SHA256: $sha"
