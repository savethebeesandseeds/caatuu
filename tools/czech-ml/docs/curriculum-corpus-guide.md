# Caatuu Curriculum Corpus Guide

This corpus is the language-neutral curriculum core for Caatuu learning models.
It is intended to support sentence generation, translation, and future
mode-specific fine-tuning without tying the source data to Czech only.

## Current Main Working Files

Use these as the active bilingual-ready base for language work:

```text
data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
data/curriculum/common-phrases-v0.1/curated/common-phrases.en.jsonl
```

The first file is the 5000-row cleaned curriculum core. The second file is the
500-row everyday conversation phrase bank. Treat both as primary working data.
Both use the same flat schema and include filled `czech_text`.

Everything else in `data/curriculum/` is either companion metadata, validation
output, reports, prompts, or preserved source/intermediate material. Do not use
`core-v0.1` as the default base unless you are rebuilding or auditing the
cleanup pipeline.

The current app-facing cleaned version lives under:

```text
tools/czech-ml/data/curriculum/core-v0.2/
```

It is derived from the preserved `core-v0.1` corpus. The curated JSONL, prompts,
and reports under these corpus directories are intended to be tracked in git.
Local API batch/job artifacts and model weights are intentionally ignored because
they are operational state, not the corpus.

## Core Curriculum File

Use this file for downstream translation, training-data construction, and app
data ingestion:

```text
data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
```

Each row is flat JSON:

```json
{
  "id": "cc-000001",
  "english_text": "A butterfly eats a tomato.",
  "czech_text": "",
  "difficulty": 1,
  "cefr": "Pre-A1/A1",
  "age_band": "6-8",
  "topic": "food",
  "target_words": ["butterfly", "eats", "tomato"],
  "grammar_tags": ["present_simple", "singular_subject", "direct_object"],
  "child_safe": true,
  "modern_english": true,
  "concrete": true,
  "context_independent": true,
  "naturalness_score": 4,
  "simplicity_score": 5,
  "notes": ""
}
```

The curated dataset deliberately does not include API wrapper fields or review
metadata such as `custom_id`, `ok`, `status_code`, `result`, `decision`,
`reject_reasons`, or `cleanup_actions`.

## Cleaned Corpus Files

```text
source-manifest.jsonl
concept-inventory.jsonl
prompts/
reports/
curated/curriculum-core.en.jsonl
validation/en.json
```

Meanings:

- `curated/curriculum-core.en.jsonl`: current approved, flattened English curriculum corpus.
- `concept-inventory.jsonl`: concept inventory used by the item builder.
- `source-manifest.jsonl`: source/license manifest.
- `prompts/`: preserved curation/adaptation prompt notes.
- `reports/`: small provenance and validation reports.

The richer generated source tree remains in `core-v0.1`; `core-v0.2` is the
tracked cleaned corpus for downstream use.

## Common Phrases

Everyday conversation phrases live separately from the generated curriculum
core:

```text
data/curriculum/common-phrases-v0.1/curated/common-phrases.en.jsonl
```

This bank contains exactly 500 authored, child-safe English phrases across 20
conversation categories. It is not copied from any external "1000 common
phrases" list. The ranking is Caatuu coverage priority, not a corpus-frequency
claim.

Rebuild and validate it with:

```powershell
npm run build:common-phrases
npm run validate:common-phrases
```

## Quality Rules

- Keep one curriculum concept per row.
- Prefer short, concrete, child-safe, context-independent sentences.
- Favor everyday vocabulary over academic, archaic, idiomatic, or abstract text.
- Avoid meta-language such as "the word X appears".
- Keep exact duplicate English text out of the curated dataset.
- Keep `notes` blank in the curated dataset so review prose does not leak into
  model training.

## Cleanup

The cleaned `core-v0.2` corpus is reproducible from `core-v0.1`:

```powershell
npm run cleanup:curriculum
npm run validate:curriculum:clean
```

The cleanup keeps IDs stable, rewrites one side of high-confidence near-duplicate
pairs, and applies a small local semantic pass for obvious child-corpus problems
such as impossible adjective/noun pairs or animals performing classroom actions.
It does not call any paid API.

## Validation

Run:

```powershell
docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/validate-curriculum-curated.mjs `
    --dataset-dir tools/czech-ml/data/curriculum/core-v0.2
```

The validator checks:

- 5,000 rows;
- sequential `cc-000001` style ids;
- no duplicate English text after case/space normalization;
- required schema fields;
- required filled `czech_text` string field for the current bilingual corpus;
- blank `notes`;
- no old review/API wrapper fields.

It writes:

```text
data/curriculum/core-v0.2/validation/en.json
```

## Cost Guard

The API batch scripts used during early curation have been removed from the
active script surface. If we later decide to use paid API curation again, create
that workflow explicitly in a new branch or script and keep request/job/output
artifacts out of the tracked corpus.

## LoRA Dataset Outputs

The bilingual corpus builds the current utility-model training data:

```powershell
npm run build:lora-datasets
npm run validate:lora-datasets
```

Outputs:

```text
data/models/czech-finetuned/training-data/translation-cs-en-001/
data/models/czech-finetuned/training-data/czech-word-sentence-001/
```

The translation dataset trains Czech to English. The word-sentence dataset
trains: given one Czech target word, generate one short Czech sentence
containing that exact surface form.

Both builders create deterministic, deduplicated training, validation, and
held-out benchmark splits. The benchmark is excluded from `train_all`. For the
word-sentence task, validation target words do not occur in training, while the
test benchmark is split into seen and unseen target words so memorization and
generalization are reported separately. Run `npm run validate:lora-datasets`
after every corpus or split-policy change; it fails on leakage, duplicates,
contract violations, or a malformed `train_all` union.
