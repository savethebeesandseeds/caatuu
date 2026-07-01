# Caatuu Czech ML Workspace

This folder contains the model-building side of Caatuu Czech.

The browser app is here:

```text
C:\Work\caatuu\apps\caatuu-czech
```

This workspace keeps the heavy assets and ML-only tooling:

```text
data/corpus/
data/models/english-base/
data/models/tools/
data/models/czech-finetuned/training-data/
data/models/czech-finetuned/runs/
data/models/czech-finetuned/exports/
```

## Node Tools

Node handles the non-ML data preparation that does not need Python.

```bash
cd /workspace/tools/caatuu-cz-ml
npm run check
npm run build:corpus
npm run build:dataset
```

For a safe dataset-builder check that does not overwrite the saved dataset:

```bash
npm run build:dataset -- --out-dir /tmp/caatuu-cz-dataset-check
```

## Python ML Tools

Python remains only for the hard ML steps:

- train LoRA adapters
- run live model benchmarks
- merge PEFT adapters into Hugging Face models
- convert/export through MLC/WebLLM

Create the environment inside Debian only when doing that work:

```bash
python3 -m venv /opt/caatuu-ml
. /opt/caatuu-ml/bin/activate
python -m pip install -U pip wheel setuptools
```

Install PyTorch, Transformers, PEFT, Accelerate, and MLC packages inside that
environment before training or exporting.

## Current Model

The current trained/exported run is:

```text
qwen3-1.7b-lora-003-hard
```

The full adapter/checkpoints are in:

```text
data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/
```

The browser-ready WebLLM export remains in the app:

```text
C:\Work\caatuu\apps\caatuu-czech\static\data\models\czech-finetuned\exports\qwen3-1.7b-lora-003-hard\
```

No retraining is needed to run the current demo.

## Future Training

From `/workspace/tools/caatuu-cz-ml` inside Debian, after activating the ML
environment:

```bash
python data/models/tools/train_lora.py \
  --train data/models/czech-finetuned/training-data/train.jsonl \
  --val data/models/czech-finetuned/training-data/val.jsonl \
  --out data/models/czech-finetuned/runs/qwen3-1.7b-lora-next \
  --max-steps 3200 \
  --batch-size 1 \
  --grad-accum 8 \
  --load-best-model-at-end
```

Benchmark:

```bash
python data/models/tools/czech_language_benchmark.py \
  --tuned-model data/models/czech-finetuned/runs/qwen3-1.7b-lora-next/adapter \
  --out-json data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-next.json \
  --out-md data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-next.md
```

Export:

```bash
python data/models/tools/export_webllm.py --run-id qwen3-1.7b-lora-next --stage all
npm run finalize:webllm -- --run-id qwen3-1.7b-lora-next
```

After validating a new export, copy only the browser-ready WebLLM export and
small UI metadata back into `apps/caatuu-czech/static/data/models/`.
