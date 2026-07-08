# Planet Word Net Model Runbook

This is the repeatable path for training and publishing a Czech Planet Word Net utility model. The goal is narrow: given one selected word, return one Czech sentence that contains that exact word.

Keep the base model and every trained adapter separate. Do not overwrite `cstinyllama-1.2b-base` or a previous run.

## Containers

Use the existing dev container for ML work:

```powershell
docker exec -it caatuu-dev bash
```

Inside the container:

```bash
cd /workspace/tools/caatuu-cz-ml
. /opt/caatuu-ml/bin/activate
```

The runtime container should stay small. Do not install training packages in `caatuu`.

## 1. Build A Dataset

Choose a new dataset ID and write it under `training-data/`.

For the clean SFT path, do not use synthetic copy anchors. This is the preferred
path after the `planet-wordnet-002` model learned meta-sentences such as
`Slovo X je v teto vete.`

```bash
npm run build:planet-wordnet -- \
  --out-dir data/models/czech-finetuned/training-data/planet-wordnet-003 \
  --clean-sft \
  --benchmark-words 420 \
  --max-rows 140000
```

Outputs:

```text
train.jsonl
all.jsonl
benchmark.jsonl
summary.json
sources.json
```

`benchmark.jsonl` is not a loss-validation split. It is a generated-output check:
pick a word, generate a sentence, and verify the sentence contains the exact
target form, is one short Czech sentence, and avoids meta-language.

Clean SFT output should show:

```text
clean_sft = true
anchor_repeats = 0
prompt_variants_per_word = 1
training_row_source_counts.synthetic_copy_anchor absent
```

## 2. Train A LoRA

Start with a fresh run ID. For a long overnight run:

```bash
RUN_ID=cstinyllama-1.2b-planet-wordnet-003-clean-sft
TRAIN_FILE=data/models/czech-finetuned/training-data/planet-wordnet-003/train.jsonl
mkdir -p "data/models/czech-finetuned/runs/$RUN_ID"

MAX_STEPS=15000 \
RUN_ID="$RUN_ID" \
TRAIN_FILE="$TRAIN_FILE" \
bash scripts/train-planet-wordnet-001.sh \
  > "data/models/czech-finetuned/runs/$RUN_ID/train.log" 2>&1
```

To continue from a previous adapter:

```bash
RUN_ID=cstinyllama-1.2b-planet-wordnet-003-copy
TRAIN_FILE=data/models/czech-finetuned/training-data/planet-wordnet-003/train.jsonl
ADAPTER_IN=data/models/czech-finetuned/runs/cstinyllama-1.2b-planet-wordnet-003/adapter
mkdir -p "data/models/czech-finetuned/runs/$RUN_ID"

MAX_STEPS=6000 \
RUN_ID="$RUN_ID" \
TRAIN_FILE="$TRAIN_FILE" \
ADAPTER_IN="$ADAPTER_IN" \
bash scripts/train-planet-wordnet-001.sh \
  > "data/models/czech-finetuned/runs/$RUN_ID/train.log" 2>&1
```

Check progress from another shell:

```bash
RUN_ID=cstinyllama-1.2b-planet-wordnet-003 bash scripts/planet-wordnet-status.sh
```

## 3. Evaluate

Run a deterministic benchmark against the adapter:

```bash
RUN_ID=cstinyllama-1.2b-planet-wordnet-003-copy
DATASET=data/models/czech-finetuned/training-data/planet-wordnet-003
RUN_DIR=data/models/czech-finetuned/runs/$RUN_ID

python data/models/tools/planet_wordnet_eval.py \
  --adapter "$RUN_DIR/adapter" \
  --benchmark "$DATASET/benchmark.jsonl" \
  --out-jsonl "$RUN_DIR/eval-full.jsonl" \
  --out-json "$RUN_DIR/eval-full-summary.json" \
  --limit 0 \
  --temperature 0 \
  --max-new-tokens 48
```

A useful model should pass:

```text
contains_word = benchmark size
one_sentence = benchmark size
czech_ok = benchmark size
```

The last accepted run passed 420/420, but it is intentionally templated. That is acceptable for the first game utility because reliability matters more than natural variety.

## 4. Merge The Adapter

Merge the adapter into a standalone Hugging Face export:

```bash
RUN_ID=cstinyllama-1.2b-planet-wordnet-003-copy

python data/models/tools/merge_completion_lora.py \
  --model-id BUT-FIT/CSTinyLlama-1.2B \
  --adapter "data/models/czech-finetuned/runs/$RUN_ID/adapter" \
  --out "data/models/czech-finetuned/exports/$RUN_ID/merged-hf"
```

The base model remains unchanged. The merged export is a derived artifact for conversion.

## 5. Add A Phone-Bench Config

Add one entry to `tools/phone-bench/model-configs.json` using a new key:

```json
"cstinyllama-1.2b-planet-wordnet-003-copy": {
  "label": "Caatuu Planet Word Net CSTinyLlama 1.2B LoRA 003 Copy",
  "run_id": "cstinyllama-1.2b-planet-wordnet-003-copy",
  "source_type": "local_hf",
  "repo_id": "BUT-FIT/CSTinyLlama-1.2B",
  "license": "Apache-2.0",
  "model_hf_dir": "../caatuu-cz-ml/data/models/czech-finetuned/exports/cstinyllama-1.2b-planet-wordnet-003-copy/merged-hf",
  "model_basename": "caatuu-czech-cstinyllama-1.2b-planet-wordnet-003-copy",
  "artifact_subdir": "cstinyllama-1.2b-planet-wordnet-003-copy",
  "quantization": "Q4_K_M",
  "app_label": "Planet Word Net CZ",
  "short_label": "Word Net",
  "base_model": "BUT-FIT CSTinyLlama 1.2B",
  "adapter": "cstinyllama-1.2b-planet-wordnet-003-copy",
  "intended_use": "Planet of Word Net: generate one Czech sentence containing the selected word.",
  "supports_thinking": false,
  "notes": [
    "CSTinyLlama LoRA trained for exact selected-word inclusion.",
    "Use with prompt format: Slovo: WORD newline Věta:",
    "Full local benchmark passed exact case-insensitive word-in-sentence checks."
  ]
}
```

## 6. Convert And Publish GGUF

From inside `caatuu-dev`:

```bash
cd /workspace/tools/phone-bench
bash scripts/publish-configured-model.sh cstinyllama-1.2b-planet-wordnet-003-copy
```

The wrapper:

- fixes CSTinyLlama tokenizer metadata when needed
- runs `prepare-model.sh`
- quantizes to `Q4_K_M`
- publishes static model files and `models.json`
- removes the temporary F16 GGUF unless `CLEAN_F16=0`

Expected static output:

```text
apps/caatuu-czech/static/data/models/phone-bench/<model>.gguf
apps/caatuu-czech/static/data/models/phone-bench/<model>.gguf.sha256
apps/caatuu-czech/static/data/models/phone-bench/<model-key>.manifest.json
apps/caatuu-czech/static/data/models/phone-bench/models.json
```

## 7. Wire The App

For a new model key, update:

```text
apps/caatuu-android/app/src/main/java/com/caatuu/android/ModelManager.kt
apps/caatuu-czech/static/chat.js
apps/caatuu-czech/static/app.js
apps/caatuu-czech/static/chat.html
apps/caatuu-czech/static/index.html
apps/caatuu-czech/static/sw.js
```

For Planet Word Net, the UI should send this completion prompt to the native model:

```text
Slovo: <selected word>
Věta:
```

Keep the user-visible chat message as the raw word.

## 8. Build And Verify APK

Build:

```powershell
docker run --rm -i `
  -v C:\Work\caatuu:/workspace `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -w /workspace `
  debian:latest `
  bash -lc "bash tools/android-build/setup-container.sh && bash tools/android-build/setup-sdk.sh && bash tools/android-build/build-debug-apk.sh"
```

Verify:

```powershell
Invoke-WebRequest http://127.0.0.1:8765/android/caatuu.json -UseBasicParsing
Invoke-WebRequest https://caatuu.waajacu.com/android/caatuu.json -UseBasicParsing
Invoke-WebRequest https://caatuu.waajacu.com/cz/data/models/phone-bench/models.json -UseBasicParsing
Invoke-WebRequest https://caatuu.waajacu.com/cz/data/models/phone-bench/<model-file>.gguf -Method Head -UseBasicParsing
```

Check these fields before telling the app to update:

```text
version_code
version_name
apk sha256
model bytes
model sha256
HTTP 200 from local and public URLs
```
