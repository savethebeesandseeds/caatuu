#!/usr/bin/env bash
set -euo pipefail

echo "== System tools =="
for cmd in python pip node npm git git-lfs cmake ninja gcc g++ make cargo rustc java nvidia-smi; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "%-12s %s\n" "$cmd" "$(command -v "$cmd")"
  else
    printf "%-12s MISSING\n" "$cmd"
    exit 1
  fi
done

echo
echo "== Versions =="
python --version
pip --version
node --version
npm --version
git --version
cmake --version | head -n 1
cargo --version
rustc --version
java -version 2>&1 | head -n 1

echo
echo "== Python ML imports =="
python - <<'PY'
import importlib

packages = [
    "torch",
    "transformers",
    "peft",
    "accelerate",
    "datasets",
    "huggingface_hub",
    "safetensors",
    "sentencepiece",
]
for package in packages:
    module = importlib.import_module(package)
    version = getattr(module, "__version__", "unknown")
    print(f"{package}: {version}")

import torch
print(f"torch.cuda.is_available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"torch.cuda.device_count: {torch.cuda.device_count()}")
    print(f"torch.cuda.device_name: {torch.cuda.get_device_name(0)}")
PY

echo
echo "== MLC probe =="
/opt/caatuu-mlc/bin/python -m mlc_llm --help >/tmp/caatuu-mlc-help.txt
head -n 1 /tmp/caatuu-mlc-help.txt

echo
echo "== Repo command probes =="
cd /workspace/tools/czech-ml
npm run check
python scripts/ml/train_lora.py --help >/tmp/caatuu-train-lora-help.txt
python scripts/ml/export_webllm.py --help >/tmp/caatuu-export-webllm-help.txt
/opt/caatuu-mlc/bin/python scripts/ml/export_webllm.py --stage status >/tmp/caatuu-export-webllm-status.json

cd /workspace/tools/on-device-models
python scripts/resolve-model-config.py >/tmp/caatuu-phone-model-config.env

echo "Caatuu dev environment is ready."
