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
npm run build:lora-datasets
npm run validate:lora-datasets
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

## Phone Benchmark Export

For phones whose browser cannot run WebGPU, use the separate native benchmark
workspace:

```text
/workspace/tools/phone-bench
```

That path converts the merged Hugging Face export to a quantized GGUF file and
benchmarks it with `llama.cpp` on Android through Termux. It is for measuring
whether the current Czech model is operational on the phone before we build an
Android UI wrapper.

## Vector Database Infrastructure

The shared SQLite schema for Czech embeddings is:

```text
vector-schema.sql
```

The current generated embedding model is `caatuu-local-hash-v0.1`. It is
a deterministic local baseline for lexical sentence retrieval. The vector input
is only `english_text`; metadata is stored in SQLite for filtering and reports,
not mixed into the embedding. The planned semantic replacement remains
`BAAI/bge-small-en-v1.5`.

The same database can include manually described image assets. The current
asset keymap lives at:

```text
C:\Work\caatuu\apps\caatuu-unified\static\assets\characters\miscellaneous\keymap.json
```

Those entries must be written by inspecting the images. The vector build only
embeds those manual English descriptions and records lookup rows in
`asset_embedding_refs`.

Build or refresh generated indexes under:

```text
C:\Work\caatuu\apps\caatuu-czech\static\data\embeddings\
```

The current main bilingual-ready corpus files are:

```text
data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
data/curriculum/common-phrases-v0.1/curated/common-phrases.en.jsonl
```

Use these as the base language data. Both files include `english_text` and a
required filled `czech_text` field. The `core-v0.1` files are preserved
source/intermediate material for rebuilds and audits.

The app-facing curated corpus is the cleaned `core-v0.2` dataset. It is derived
from preserved `core-v0.1` rows with deterministic duplicate and semantic
cleanup:

```powershell
npm run cleanup:curriculum
npm run validate:curriculum:clean
```

The authored everyday conversation phrase bank is separate:

```powershell
npm run build:common-phrases
npm run validate:common-phrases
```

It writes 500 MIT-compatible rows under
`data/curriculum/common-phrases-v0.1/`.

To rebuild the current curriculum vector DB from the cleaned JSONL:

```powershell
npm run build:vector-db
```

This writes the tracked SQLite database, updates its tracked manifest, and
refreshes the vector quality files under `data/curriculum/core-v0.2/validation`
and `data/curriculum/core-v0.2/reports`.
It also ingests the manual miscellaneous image keymap when that file exists and
updates the embedding entries in `apps/caatuu-czech/static/setup-assets.json`.

The curated curriculum SQLite database is tracked in Git with the JSONL corpus.
Keep heavier future embedding runtime files out of Git. The browser and Android
managers expect normalized 384-dimensional `float32le` vectors. Do not label
local hash vectors as BGE vectors.

The embedding rule is strict: compute vectors from `english_text` only. Store
`czech_text`, topic, target words, grammar tags, difficulty, and age band as
metadata for filtering and review, but do not mix them into the embedding input.

## Curriculum Utility LoRAs

The current bilingual corpus can build two utility-model datasets:

```powershell
npm run build:lora-datasets
npm run validate:lora-datasets
```

Outputs:

```text
data/models/czech-finetuned/training-data/translation-cs-en-001/
data/models/czech-finetuned/training-data/czech-word-sentence-001/
```

Training wrappers:

```bash
bash scripts/train-czech-translation-cs-en-001.sh
bash scripts/train-czech-word-sentence-001.sh
```

Full details are in:

```text
CURRICULUM_LORA_RUNBOOK.md
```

## Planet Word Net Utility Models

The first game-specific utility model is documented here:

```text
tools/caatuu-cz-ml/PLANET_WORDNET_MODEL_RUNBOOK.md
```

That runbook covers dataset generation, hard LoRA training, evaluation, adapter
merge, GGUF publication, Android wiring, APK build, and endpoint verification.
