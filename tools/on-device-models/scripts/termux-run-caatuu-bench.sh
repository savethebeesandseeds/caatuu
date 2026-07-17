#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://caatuu.waajacu.com/cz/data/models/phone-bench}"
MODEL_FILE="${MODEL_FILE:-caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf}"
WORK_DIR="${WORK_DIR:-$HOME/caatuu-phone-bench}"
LLAMA_DIR="$WORK_DIR/llama.cpp"
MODEL_DIR="$WORK_DIR/models"
RESULT_DIR="$WORK_DIR/results"
PROMPT_FILE="$WORK_DIR/czech-smoke.txt"

mkdir -p "$MODEL_DIR" "$RESULT_DIR"

if command -v pkg >/dev/null 2>&1; then
  pkg update -y
  pkg install -y git cmake clang make curl coreutils
fi

if [ ! -d "$LLAMA_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi

cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build-termux" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF
cmake --build "$LLAMA_DIR/build-termux" --config Release -j "$(nproc)"

MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
if [ ! -f "$MODEL_PATH" ]; then
  curl -L "$BASE_URL/$MODEL_FILE" -o "$MODEL_PATH"
fi

curl -L "$BASE_URL/czech-smoke.txt" -o "$PROMPT_FILE"
curl -L "$BASE_URL/$MODEL_FILE.sha256" -o "$MODEL_PATH.sha256"

(
  cd "$MODEL_DIR"
  sha256sum -c "$MODEL_FILE.sha256"
)

LLAMA_CLI="$LLAMA_DIR/build-termux/bin/llama-cli"
LLAMA_BENCH="$LLAMA_DIR/build-termux/bin/llama-bench"
STAMP="$(date +%Y%m%d-%H%M%S)"
RESULT_FILE="$RESULT_DIR/caatuu-phone-bench-$STAMP.txt"

{
  echo "Caatuu Czech phone benchmark"
  echo "Date: $(date -Iseconds)"
  echo "Device: $(getprop ro.product.manufacturer 2>/dev/null || true) $(getprop ro.product.model 2>/dev/null || true)"
  echo "Android: $(getprop ro.build.version.release 2>/dev/null || true)"
  echo "Model: $MODEL_PATH"
  echo
  echo "llama-bench"
  "$LLAMA_BENCH" -m "$MODEL_PATH" -p 64 -n 64 -t "$(nproc)" || true
  echo
  echo "Czech prompts"
} | tee "$RESULT_FILE"

prompt_index=0
while IFS= read -r prompt || [ -n "$prompt" ]; do
  if [ -z "$prompt" ] || [ "$prompt" = "---" ]; then
    continue
  fi
  prompt_index=$((prompt_index + 1))
  {
    echo
    echo "Prompt $prompt_index"
    echo "$prompt"
    echo
    "$LLAMA_CLI" \
      -m "$MODEL_PATH" \
      -c 768 \
      -n 96 \
      -t "$(nproc)" \
      --temp 0 \
      --jinja \
      -cnv \
      -st \
      --chat-template-kwargs '{"enable_thinking":false}' \
      --no-display-prompt \
      -p "$prompt"
  } 2>&1 | tee -a "$RESULT_FILE"
done < "$PROMPT_FILE"

echo
echo "Saved result:"
echo "$RESULT_FILE"
