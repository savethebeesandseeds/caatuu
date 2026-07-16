#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_ID="${RUN_ID:-qwen3-1.7b-translation-cs-en-001}"
RUN_DIR="data/models/czech-finetuned/runs/$RUN_ID"
DATASET_DIR="${DATASET_DIR:-data/models/czech-finetuned/training-data/translation-cs-en-qwen3-chat-001}"
BATCH_SIZE_VALUE="${BATCH_SIZE:-1}"
GRAD_ACCUM_VALUE="${GRAD_ACCUM:-8}"
TARGET_EPOCHS_VALUE="${TARGET_EPOCHS:-2}"

if [ -n "${PYTHON:-}" ]; then
  PYTHON_BIN="$PYTHON"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
elif [ -x /opt/caatuu-ml/bin/python ]; then
  PYTHON_BIN="/opt/caatuu-ml/bin/python"
else
  PYTHON_BIN="python3"
fi

node scripts/build-qwen-translation-chat-dataset.mjs --out-dir "$DATASET_DIR"

TRAIN_ROWS="$(wc -l < "$DATASET_DIR/train.jsonl")"
EFFECTIVE_BATCH=$((BATCH_SIZE_VALUE * GRAD_ACCUM_VALUE))
DEFAULT_MAX_STEPS=$(((TRAIN_ROWS * TARGET_EPOCHS_VALUE + EFFECTIVE_BATCH - 1) / EFFECTIVE_BATCH))
MAX_STEPS_VALUE="${MAX_STEPS:-$DEFAULT_MAX_STEPS}"

mkdir -p "$RUN_DIR"
echo "$$" > "$RUN_DIR/train.pid"
date -Is > "$RUN_DIR/train.started"

"$PYTHON_BIN" data/models/tools/train_lora.py \
  --model-id "${MODEL_ID:-Qwen/Qwen3-1.7B}" \
  --train "$DATASET_DIR/train.jsonl" \
  --val "$DATASET_DIR/val.jsonl" \
  --out "$RUN_DIR" \
  --max-length "${MAX_LENGTH:-256}" \
  --max-steps "$MAX_STEPS_VALUE" \
  --batch-size "$BATCH_SIZE_VALUE" \
  --grad-accum "$GRAD_ACCUM_VALUE" \
  --learning-rate "${LEARNING_RATE:-8e-5}" \
  --lora-r "${LORA_R:-32}" \
  --lora-alpha "${LORA_ALPHA:-64}" \
  --lora-dropout "${LORA_DROPOUT:-0.05}" \
  --lora-targets "${LORA_TARGETS:-q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj}" \
  --warmup-steps "${WARMUP_STEPS:-60}" \
  --logging-steps "${LOGGING_STEPS:-25}" \
  --eval-steps "${EVAL_STEPS:-100}" \
  --save-steps "${SAVE_STEPS:-200}" \
  --save-total-limit "${SAVE_TOTAL_LIMIT:-4}" \
  --lr-scheduler-type "${LR_SCHEDULER_TYPE:-cosine}" \
  --load-best-model-at-end

date -Is > "$RUN_DIR/train.finished"
