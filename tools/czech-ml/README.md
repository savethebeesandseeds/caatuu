# Caatuu Czech ML Workspace

This folder contains the model-building side of Caatuu Czech.

The browser app is here:

```text
C:\Work\caatuu\apps\languages\czech
```

This workspace keeps the heavy assets and ML-only tooling:

```text
data/corpus/
data/models/english-base/
scripts/ml/
data/models/czech-finetuned/training-data/
data/models/czech-finetuned/runs/
data/models/czech-finetuned/exports/
```

## Node Tools

Node handles the non-ML data preparation that does not need Python.

```bash
cd /workspace/tools/czech-ml
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
C:\Work\caatuu\apps\languages\czech\static\data\models\czech-finetuned\exports\qwen3-1.7b-lora-003-hard\
```

No retraining is needed to run the current demo.

## Future Training

From `/workspace/tools/czech-ml` inside Debian, after activating the ML
environment:

```bash
python scripts/ml/train_lora.py \
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
python scripts/ml/czech_language_benchmark.py \
  --tuned-model data/models/czech-finetuned/runs/qwen3-1.7b-lora-next/adapter \
  --out-json data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-next.json \
  --out-md data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-next.md
```

Export:

```bash
python scripts/ml/export_webllm.py --run-id qwen3-1.7b-lora-next --stage all
npm run finalize:webllm -- --run-id qwen3-1.7b-lora-next
```

After validating a new export, copy only the browser-ready WebLLM export and
small UI metadata back into `apps/languages/czech/static/data/models/`.

## Phone Benchmark Export

For phones whose browser cannot run WebGPU, use the separate native benchmark
workspace:

```text
/workspace/tools/on-device-models
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

The active embedding model is the Apache-2.0 licensed
`sentence-transformers/all-MiniLM-L6-v2`, pinned at revision
`1110a243fdf4706b3f48f1d95db1a4f5529b4d41` and exported as the qint8 ARM64
ONNX artifact `all-minilm-l6-v2-qint8-v0.1`. The vector input is only
`english_text`; metadata is stored in SQLite for filtering and reports, not
mixed into the embedding.

The same database can include manually described image assets. The current
miscellaneous asset keymap lives at:

```text
C:\Work\caatuu\apps\launcher\static\assets\visual-vocabulary\keymap.json
```

The current macaw action asset keymap lives at:

```text
C:\Work\caatuu\apps\launcher\static\assets\macaw\actions\keymaps.json
```

Those entries must be written by inspecting the images. The vector build only
embeds those manual English descriptions and records lookup rows in
`asset_embedding_refs` or `macaw_action_embedding_refs`.

Build or refresh generated indexes under:

```text
C:\Work\caatuu\apps\languages\czech\static\data\embeddings\
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

This writes the tracked semantic SQLite database, updates its tracked manifest,
and refreshes the vector quality files under
`data/curriculum/core-v0.2/validation` and
`data/curriculum/core-v0.2/reports`.
It also ingests the manual miscellaneous and macaw action image keymaps when
those files exist and updates the embedding entries in
`apps/languages/czech/static/setup-assets.json`.

Run the human-reviewed retrieval regression suite after rebuilding:

```powershell
npm run evaluate:images
```

The curated curriculum SQLite database is tracked in Git with the JSONL corpus.
The Transformers.js bundle is vendored, while the ONNX model and ONNX Runtime
WASM files stay out of Git and are downloaded through the setup manifest after
install. The browser and Android WebView use the same local semantic runtime and
expect normalized 384-dimensional `float32le` vectors. The legacy local-hash DB
is retained only as a rollback/debug artifact and must never be compared with
semantic query vectors.

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

Each build produces deterministic, deduplicated `train`, `val`, and held-out
`benchmark` splits. `train_all` is exactly `train + val` and deliberately
excludes the benchmark. The word-sentence benchmark includes separate seen and
unseen target-word partitions, and the validator enforces zero target leakage
for the unseen partition.

Training wrappers:

```bash
bash scripts/train-czech-translation-cs-en-001.sh
bash scripts/train-czech-word-sentence-001.sh
```

The wrappers derive their default step budget from row count and target epochs,
evaluate against `val.jsonl`, and restore the best validation-loss checkpoint.
Use a new `RUN_ID` for every corrected experiment; do not overwrite an older
adapter or its logs.

Full details are in:

```text
docs/curriculum-lora-runbook.md
```

## Planet Word Net Utility Models

The first game-specific utility model is documented here:

```text
tools/czech-ml/docs/planet-wordnet-model-runbook.md
```

That runbook covers dataset generation, hard LoRA training, evaluation, adapter
merge, GGUF publication, Android wiring, APK build, and endpoint verification.
