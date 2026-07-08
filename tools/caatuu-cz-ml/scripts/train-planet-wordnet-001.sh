#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_ID="${RUN_ID:-cstinyllama-1.2b-planet-wordnet-001}"
RUN_DIR="data/models/czech-finetuned/runs/$RUN_ID"
TRAIN_FILE="${TRAIN_FILE:-data/models/czech-finetuned/training-data/planet-wordnet-001/train.jsonl}"

mkdir -p "$RUN_DIR"
echo "$$" > "$RUN_DIR/train.pid"
date -Is > "$RUN_DIR/train.started"

args=(
  data/models/tools/train_completion_lora.py
  --model-id BUT-FIT/CSTinyLlama-1.2B
  --train "$TRAIN_FILE"
  --out "$RUN_DIR"
  --max-length "${MAX_LENGTH:-160}"
  --max-steps "${MAX_STEPS:-15000}"
  --batch-size "${BATCH_SIZE:-1}"
  --grad-accum "${GRAD_ACCUM:-4}"
  --learning-rate "${LEARNING_RATE:-1e-4}"
  --lora-r "${LORA_R:-16}"
  --lora-alpha "${LORA_ALPHA:-32}"
  --lora-dropout "${LORA_DROPOUT:-0.05}"
  --warmup-steps "${WARMUP_STEPS:-300}"
  --logging-steps "${LOGGING_STEPS:-25}"
  --save-steps "${SAVE_STEPS:-2500}"
  --save-total-limit "${SAVE_TOTAL_LIMIT:-2}"
  --lr-scheduler-type "${LR_SCHEDULER_TYPE:-cosine}"
)

if [ -n "${ADAPTER_IN:-}" ]; then
  args+=(--adapter-in "$ADAPTER_IN")
fi

python "${args[@]}"

date -Is > "$RUN_DIR/train.finished"
