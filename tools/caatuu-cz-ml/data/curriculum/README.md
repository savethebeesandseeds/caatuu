# Caatuu Curriculum Data

This folder contains the reusable curriculum corpus for Caatuu language models.

## Current Main Working Files

Use these files as the active bilingual-ready base for translation, training-data
construction, app data ingestion, and vector indexing:

```text
core-v0.2/curated/curriculum-core.en.jsonl
common-phrases-v0.1/curated/common-phrases.en.jsonl
```

`core-v0.2/curated/curriculum-core.en.jsonl` is the cleaned 5000-row curriculum
core. `common-phrases-v0.1/curated/common-phrases.en.jsonl` is the 500-row
everyday conversation phrase bank.

Both files use the same flat schema. `english_text` is populated now;
`czech_text` is required and may be blank until the translation pass fills it.

## Supporting Files

The `core-v0.1` directory is preserved source/intermediate material for audit
and reproducible cleanup. It is not the default working base.

The source layers are:

```text
core-v0.1/source-manifest.jsonl
core-v0.1/concept-inventory.jsonl
core-v0.1/curriculum-items.jsonl
core-v0.1/realizations/curriculum-realizations.en.jsonl
```

Each dataset directory may also contain validation reports, provenance reports,
or prompt notes. Those files help explain and reproduce the corpus, but the two
curated files above are the primary language data.

Validate with:

```powershell
$node='C:\Users\santi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/validate-curriculum-curated.mjs
```

The app can remain MIT while the corpus keeps its own source and attribution
records. Do not collapse these into one license field.
