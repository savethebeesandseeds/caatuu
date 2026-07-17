#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TRANSLATION_RUN_ID="${TRANSLATION_RUN_ID:-cstinyllama-1.2b-translation-cs-en-001}"
WORD_SENTENCE_RUN_ID="${WORD_SENTENCE_RUN_ID:-cstinyllama-1.2b-czech-word-sentence-001}"
QUEUE_DIR="data/models/czech-finetuned/runs/curriculum-utility-loras-001"

mkdir -p "$QUEUE_DIR"
echo "$$" > "$QUEUE_DIR/train.pid"
date -Is > "$QUEUE_DIR/train.started"

run_translation() {
  local run_dir="data/models/czech-finetuned/runs/$TRANSLATION_RUN_ID"
  mkdir -p "$run_dir"
  echo "Starting $TRANSLATION_RUN_ID" | tee -a "$QUEUE_DIR/train.log"
  MAX_STEPS="${TRANSLATION_MAX_STEPS:-8000}" \
  RUN_ID="$TRANSLATION_RUN_ID" \
  TRAIN_FILE="${TRANSLATION_TRAIN_FILE:-data/models/czech-finetuned/training-data/translation-cs-en-001/train.jsonl}" \
  bash scripts/train-czech-translation-cs-en-001.sh > "$run_dir/train.log" 2>&1
  echo "Finished $TRANSLATION_RUN_ID" | tee -a "$QUEUE_DIR/train.log"
}

run_word_sentence() {
  local run_dir="data/models/czech-finetuned/runs/$WORD_SENTENCE_RUN_ID"
  mkdir -p "$run_dir"
  echo "Starting $WORD_SENTENCE_RUN_ID" | tee -a "$QUEUE_DIR/train.log"
  MAX_STEPS="${WORD_SENTENCE_MAX_STEPS:-12000}" \
  RUN_ID="$WORD_SENTENCE_RUN_ID" \
  TRAIN_FILE="${WORD_SENTENCE_TRAIN_FILE:-data/models/czech-finetuned/training-data/czech-word-sentence-001/train.jsonl}" \
  bash scripts/train-czech-word-sentence-001.sh > "$run_dir/train.log" 2>&1
  echo "Finished $WORD_SENTENCE_RUN_ID" | tee -a "$QUEUE_DIR/train.log"
}

run_translation
run_word_sentence

date -Is > "$QUEUE_DIR/train.finished"
