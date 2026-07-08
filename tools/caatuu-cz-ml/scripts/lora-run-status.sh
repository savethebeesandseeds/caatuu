#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_ID="${RUN_ID:-cstinyllama-1.2b-translation-cs-en-001}"
RUN_DIR="data/models/czech-finetuned/runs/$RUN_ID"
LOG="$RUN_DIR/train.log"

echo "run_dir=$RUN_DIR"

if [ -f "$LOG" ]; then
  echo "progress:"
  tr "\r" "\n" < "$LOG" | grep -E "[0-9]+%\\|" | tail -3 || true

  echo "metrics:"
  python3 - "$LOG" <<'PY'
import ast
import pathlib
import re
import sys

text = pathlib.Path(sys.argv[1]).read_text(errors="ignore")
metrics = []
for match in re.finditer(r"\{[^{}]*'loss'[^{}]*\}", text):
    try:
        metrics.append(ast.literal_eval(match.group(0)))
    except Exception:
        pass
for row in metrics[-8:]:
    print(row)
PY
else
  echo "progress: no train.log yet"
fi

echo "gpu:"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=memory.used,temperature.gpu,power.draw --format=csv,noheader
else
  echo "nvidia-smi unavailable"
fi

echo "size:"
du -sh "$RUN_DIR" 2>/dev/null || true

echo "checkpoints:"
find "$RUN_DIR/checkpoints" -maxdepth 1 -type d 2>/dev/null | sort | tail -5 || true

echo "process:"
ps -eo pid,ppid,stat,etime,cmd | grep train_completion_lora | grep -v grep || true

echo "finished:"
if [ -f "$RUN_DIR/train.finished" ]; then
  cat "$RUN_DIR/train.finished"
fi
