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

From `C:\Work\caatuu\tools\czech-ml`:

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
val.jsonl
train_all.jsonl
all.jsonl
benchmark.jsonl
summary.json
sources.json
```

The split contract is strict and deterministic:

- `train.jsonl` is the optimization split.
- `val.jsonl` is used for checkpoint selection and is disjoint from training.
- `benchmark.jsonl` is the untouched test split and is never included in
  `train_all.jsonl`.
- `train_all.jsonl` is exactly `train + val`; use it only for a final release
  continuation after model selection.
- `all.jsonl` is the deduplicated source-task inventory, not a training file.

The validator fails on duplicate examples, split leakage, an incorrect
`train_all` union, or a word-sentence row whose completion omits its exact
target form. For the word task it also enforces a 24-example cap per training
target and separate seen/unseen benchmark partitions.

The current deterministic build contains:

| Task | Train | Validation | Test |
| --- | ---: | ---: | ---: |
| Czech to English | 4,661 | 400 | 420 |
| Czech word to sentence | 4,310 | 160 | 420 |

For the word task, the 420-row test set is evenly divided between target words
seen during training and target words absent from both training and validation.

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
cd /workspace/tools/czech-ml
. /opt/caatuu-ml/bin/activate

RUN_ID=cstinyllama-1.2b-translation-cs-en-002 \
bash scripts/train-czech-translation-cs-en-001.sh \
  > data/models/czech-finetuned/runs/cstinyllama-1.2b-translation-cs-en-002/train.log 2>&1
```

The wrapper defaults to:

```text
base model: BUT-FIT/CSTinyLlama-1.2B
training budget: 3 target epochs (currently 3,496 optimizer steps)
validation: every 250 steps, retain best validation-loss checkpoint
LoRA r/alpha/dropout: 16 / 32 / 0.05
```

`MAX_STEPS` remains an explicit override. Otherwise the wrapper computes the
step budget from the current training row count, batch size, gradient
accumulation, and `TARGET_EPOCHS` so a dataset rebuild cannot silently change
the effective epoch count.

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
cd /workspace/tools/czech-ml
. /opt/caatuu-ml/bin/activate

RUN_ID=cstinyllama-1.2b-czech-word-sentence-003 \
bash scripts/train-czech-word-sentence-001.sh \
  > data/models/czech-finetuned/runs/cstinyllama-1.2b-czech-word-sentence-003/train.log 2>&1
```

The wrapper defaults to:

```text
base model: BUT-FIT/CSTinyLlama-1.2B
training budget: 3 target epochs (currently 3,233 optimizer steps)
validation: every 250 steps, retain best validation-loss checkpoint
LoRA r/alpha/dropout: 16 / 32 / 0.05
```

## 4. Status

For either run:

```bash
RUN_ID=cstinyllama-1.2b-translation-cs-en-002 bash scripts/lora-run-status.sh
RUN_ID=cstinyllama-1.2b-czech-word-sentence-003 bash scripts/lora-run-status.sh
```

Train these sequentially on the RTX A2000. Do not run both at the same time.

## 5. After Training

Use the existing completion LoRA merge path:

```bash
python scripts/ml/merge_completion_lora.py \
  --model-id BUT-FIT/CSTinyLlama-1.2B \
  --adapter data/models/czech-finetuned/runs/<RUN_ID>/adapter \
  --out data/models/czech-finetuned/exports/<RUN_ID>/merged-hf
```

Then add a phone-bench model config and publish the GGUF only after the adapter
passes the complete benchmark. Report exact-match and word-F1 for translation;
report exact target inclusion separately for the seen and unseen word splits.
Do not select a checkpoint or tune decoding settings against the benchmark.
