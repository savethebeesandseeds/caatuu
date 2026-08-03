#!/usr/bin/env bash
set -euo pipefail

echo "== System tools =="
for cmd in python pip node npm git git-lfs cmake ninja gcc g++ make cargo rustc java; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "%-12s %s\n" "$cmd" "$(command -v "$cmd")"
  else
    printf "%-12s MISSING\n" "$cmd"
    exit 1
  fi
done

check-caatuu-gpu-readiness

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
java_version="$(java -version 2>&1 | head -n 1)"
printf "%s\n" "$java_version"
[[ "$java_version" == *'version "17.'* ]] || {
  echo "The shared Android toolchain requires the pinned JDK 17." >&2
  exit 1
}

echo
echo "== Python ML imports =="
python - <<'PY'
import importlib
import os

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
if os.environ.get("CAATUU_REQUIRE_NVIDIA", "0") == "1" and not torch.cuda.is_available():
    raise SystemExit("The GPU override requires Torch CUDA readiness.")
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

echo
echo "== Animated Fabric environment =="
cmp /tmp/animated-fabric-linux-py312.txt \
  /workspace/apps/animated-fabric/constraints/linux-py312.txt || {
  echo "The baked Animated Fabric dependency lock differs from the canonical application lock." >&2
  exit 1
}
af_python_version="$(caatuu-animated-fabric python --version 2>&1)"
printf "%-24s %s\n" "python" "$af_python_version"
[[ "$af_python_version" == Python\ 3.12.* ]] || {
  echo "Animated Fabric must use the baked Python 3.12 environment." >&2
  exit 1
}
caatuu-animated-fabric python - <<'PY'
import importlib

for package in [
    "cv2",
    "hypothesis",
    "mypy",
    "numpy",
    "PIL",
    "platformdirs",
    "pydantic",
    "PySide6",
    "pytest",
    "pytestqt",
    "rich",
    "ruff",
    "typer",
]:
    importlib.import_module(package)
    print(f"{package}: ready")
PY
caatuu-animated-fabric python -m pip check
caatuu-animated-fabric python -m animated_fabric --help >/tmp/animated-fabric-help.txt
caatuu-animated-fabric python -m animated_fabric doctor >/tmp/animated-fabric-doctor.txt
animated-fabric --help >/tmp/animated-fabric-console-help.txt
caatuu-animated-fabric python - <<'PY'
from animated_fabric.gui.app import main

assert callable(main)
PY
command -v animated-fabric-gui >/dev/null

echo "Caatuu dev environment, including Animated Fabric, is ready."
