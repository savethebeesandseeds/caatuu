#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_ID="${RUN_ID:-cstinyllama-1.2b-translation-cs-en-001}"
RUN_DIR="data/models/czech-finetuned/runs/$RUN_ID"
TRAIN_FILE="${TRAIN_FILE:-data/models/czech-finetuned/training-data/translation-cs-en-001/train.jsonl}"
VAL_FILE="${VAL_FILE:-data/models/czech-finetuned/training-data/translation-cs-en-001/val.jsonl}"
BATCH_SIZE_VALUE="${BATCH_SIZE:-1}"
GRAD_ACCUM_VALUE="${GRAD_ACCUM:-4}"
TARGET_EPOCHS_VALUE="${TARGET_EPOCHS:-3}"
TRAIN_ROWS="$(wc -l < "$TRAIN_FILE")"
EFFECTIVE_BATCH=$((BATCH_SIZE_VALUE * GRAD_ACCUM_VALUE))
DEFAULT_MAX_STEPS=$(((TRAIN_ROWS * TARGET_EPOCHS_VALUE + EFFECTIVE_BATCH - 1) / EFFECTIVE_BATCH))
MAX_STEPS_VALUE="${MAX_STEPS:-$DEFAULT_MAX_STEPS}"

mkdir -p "$RUN_DIR"
echo "$$" > "$RUN_DIR/train.pid"
date -Is > "$RUN_DIR/train.started"

args=(
  data/models/tools/train_completion_lora.py
  --model-id "${MODEL_ID:-BUT-FIT/CSTinyLlama-1.2B}"
  --train "$TRAIN_FILE"
  --val "$VAL_FILE"
  --out "$RUN_DIR"
  --max-length "${MAX_LENGTH:-160}"
  --max-steps "$MAX_STEPS_VALUE"
  --batch-size "$BATCH_SIZE_VALUE"
  --grad-accum "$GRAD_ACCUM_VALUE"
  --learning-rate "${LEARNING_RATE:-1e-4}"
  --lora-r "${LORA_R:-16}"
  --lora-alpha "${LORA_ALPHA:-32}"
  --lora-dropout "${LORA_DROPOUT:-0.05}"
  --warmup-steps "${WARMUP_STEPS:-200}"
  --logging-steps "${LOGGING_STEPS:-25}"
  --eval-steps "${EVAL_STEPS:-250}"
  --save-steps "${SAVE_STEPS:-500}"
  --save-total-limit "${SAVE_TOTAL_LIMIT:-2}"
  --lr-scheduler-type "${LR_SCHEDULER_TYPE:-cosine}"
  --load-best-model-at-end
)

if [ -n "${ADAPTER_IN:-}" ]; then
  args+=(--adapter-in "$ADAPTER_IN")
fi

if [ -n "${PYTHON:-}" ]; then
  PYTHON_BIN="$PYTHON"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
elif [ -x /opt/caatuu-ml/bin/python ]; then
  PYTHON_BIN="/opt/caatuu-ml/bin/python"
else
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" "${args[@]}"

date -Is > "$RUN_DIR/train.finished"
