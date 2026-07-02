#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://caatuu.waajacu.com/cz/data/models/phone-bench}"
MODEL_FILE="${MODEL_FILE:-caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf}"
WORK_DIR="${WORK_DIR:-$HOME/caatuu-phone-bench}"
LLAMA_DIR="$WORK_DIR/llama.cpp"
MODEL_DIR="$WORK_DIR/models"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
LLAMA_CLI="$LLAMA_DIR/build-termux/bin/llama-cli"
THREADS="${THREADS:-$(nproc)}"
CTX_SIZE="${CTX_SIZE:-768}"
TOKENS="${TOKENS:-160}"
TEMP="${TEMP:-0}"

mkdir -p "$MODEL_DIR"

if command -v pkg >/dev/null 2>&1; then
  need_packages=0
  for required in git cmake clang make curl sha256sum; do
    if ! command -v "$required" >/dev/null 2>&1; then
      need_packages=1
    fi
  done
  if [ "$need_packages" -eq 1 ]; then
    pkg update -y
    pkg install -y git cmake clang make curl coreutils
  fi
fi

if [ ! -d "$LLAMA_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi

if [ ! -x "$LLAMA_CLI" ]; then
  cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build-termux" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=ON \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF
  cmake --build "$LLAMA_DIR/build-termux" --config Release -j "$THREADS"
fi

if [ ! -f "$MODEL_PATH" ]; then
  curl -L "$BASE_URL/$MODEL_FILE" -o "$MODEL_PATH"
fi

curl -L "$BASE_URL/$MODEL_FILE.sha256" -o "$MODEL_PATH.sha256"
(
  cd "$MODEL_DIR"
  sha256sum -c "$MODEL_FILE.sha256"
)

if [ ! -x "$LLAMA_CLI" ]; then
  echo "Missing llama-cli at $LLAMA_CLI" >&2
  exit 1
fi

cat <<EOF
Caatuu Czech local chat

The model is about to load on this phone. After it loads, type a message and
press Enter. Use Ctrl+D or Ctrl+C to leave.

No system prompt is added by this script.
EOF

"$LLAMA_CLI" \
  -m "$MODEL_PATH" \
  -c "$CTX_SIZE" \
  -n "$TOKENS" \
  -t "$THREADS" \
  --temp "$TEMP" \
  --jinja \
  -cnv \
  -if \
  -mli \
  --simple-io \
  --chat-template-kwargs '{"enable_thinking":false}'
