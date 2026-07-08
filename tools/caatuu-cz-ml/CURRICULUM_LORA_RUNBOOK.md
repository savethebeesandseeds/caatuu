# Curriculum LoRA Runbook

This runbook covers the two small utility adapters built from the current
bilingual curriculum corpus:

- Czech to English translation (`translation-cs-en-001`)
- Czech target word to one Czech sentence (`czech-word-sentence-001`)

Both datasets are derived from the current main working files:

```text
data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
data/curriculum/common-phrases-v0.1/curated/common-phrases.en.jsonl
```

Do not train these adapters from the older raw Czech story corpus unless we
explicitly want a less controlled style. The point of this pass is to keep the
model inside the child-safe Caatuu curriculum style.

## 1. Rebuild The Datasets

From `C:\Work\caatuu\tools\caatuu-cz-ml`:

```powershell
npm run validate:czech-text:filled
npm run build:lora-datasets
npm run validate:lora-datasets
```

Outputs:

```text
data/models/czech-finetuned/training-data/translation-cs-en-001/
data/models/czech-finetuned/training-data/czech-word-sentence-001/
```

Each directory contains:

```text
train.jsonl
all.jsonl
benchmark.jsonl
summary.json
sources.json
```

`benchmark.jsonl` is a generation check, not a held-out loss split. These are
narrow utility models, so the first training pass uses all curated examples.

## 2. Translation Model

Task:

```text
Input: Czech sentence
Output: one simple English translation
```

Prompt format:

```text
Úkol: Přelož českou větu do jednoduché angličtiny.
Čeština: <czech_text>
Angličtina:
```

Default run:

```bash
cd /workspace/tools/caatuu-cz-ml
. /opt/caatuu-ml/bin/activate

RUN_ID=cstinyllama-1.2b-translation-cs-en-001 \
TRAIN_FILE=data/models/czech-finetuned/training-data/translation-cs-en-001/train.jsonl \
bash scripts/train-czech-translation-cs-en-001.sh \
  > data/models/czech-finetuned/runs/cstinyllama-1.2b-translation-cs-en-001/train.log 2>&1
```

The wrapper defaults to:

```text
base model: BUT-FIT/CSTinyLlama-1.2B
max steps: 8000
LoRA r/alpha/dropout: 16 / 32 / 0.05
```

## 3. Czech Word Sentence Model

Task:

```text
Input: one Czech target word
Output: one short ordinary Czech sentence containing that exact target form
```

Prompt format:

```text
Cíl: <word>
Napiš jednu krátkou běžnou českou větu. Nevysvětluj.
Věta:
```

Default run:

```bash
cd /workspace/tools/caatuu-cz-ml
. /opt/caatuu-ml/bin/activate

RUN_ID=cstinyllama-1.2b-czech-word-sentence-001 \
TRAIN_FILE=data/models/czech-finetuned/training-data/czech-word-sentence-001/train.jsonl \
bash scripts/train-czech-word-sentence-001.sh \
  > data/models/czech-finetuned/runs/cstinyllama-1.2b-czech-word-sentence-001/train.log 2>&1
```

The wrapper defaults to:

```text
base model: BUT-FIT/CSTinyLlama-1.2B
max steps: 12000
LoRA r/alpha/dropout: 16 / 32 / 0.05
```

## 4. Status

For either run:

```bash
RUN_ID=cstinyllama-1.2b-translation-cs-en-001 bash scripts/lora-run-status.sh
RUN_ID=cstinyllama-1.2b-czech-word-sentence-001 bash scripts/lora-run-status.sh
```

Train these sequentially on the RTX A2000. Do not run both at the same time.

## 5. After Training

Use the existing completion LoRA merge path:

```bash
python data/models/tools/merge_completion_lora.py \
  --model-id BUT-FIT/CSTinyLlama-1.2B \
  --adapter data/models/czech-finetuned/runs/<RUN_ID>/adapter \
  --out data/models/czech-finetuned/exports/<RUN_ID>/merged-hf
```

Then add a phone-bench model config and publish the GGUF only after the adapter
passes its benchmark checks.
