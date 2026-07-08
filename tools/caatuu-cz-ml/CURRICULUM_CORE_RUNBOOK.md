# Caatuu Curriculum Core Runbook

This is the reusable curriculum-data path for Caatuu language-learning models.

Read `CURRICULUM_CORPUS_GUIDE.md` first for the current file layout and final
schema.

This runbook is for rebuilding or auditing the `core-v0.1` source layers. For
normal app, translation, vector, or training-data work, use the current main
files documented in `CURRICULUM_CORPUS_GUIDE.md`:

```text
data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
data/curriculum/common-phrases-v0.1/curated/common-phrases.en.jsonl
```

## Build Canonical Items

Use the bundled Node runtime on Windows if `npm` is not on the shell path:

```powershell
$node='C:\Users\santi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/build-curriculum-core.mjs --max-items 5000
```

This writes the canonical source layers:

```text
data/curriculum/core-v0.1/source-manifest.jsonl
data/curriculum/core-v0.1/concept-inventory.jsonl
data/curriculum/core-v0.1/curriculum-items.jsonl
data/curriculum/core-v0.1/realizations/curriculum-realizations.en.jsonl
data/curriculum/core-v0.1/reports/
```

It does not overwrite the curated dataset:

```text
data/curriculum/core-v0.1/curated/curriculum-core.en.jsonl
```

## Validate Final Corpus

Run:

```powershell
$node='C:\Users\santi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/validate-curriculum-curated.mjs
```

Expected state:

```text
rows: 5000
unique_ids: 5000
duplicate_text_groups: 0
notes_blank: true
validation_errors: []
```

The validation report is:

```text
data/curriculum/core-v0.1/validation/en.json
```

## Source Lanes

- `clean_core`: original Caatuu rows, CC0, or verified unrestricted
  public-domain rows.
- `attribution_core`: CC BY rows with source attribution stored.
- `sharealike_quarantine`: CC BY-SA or similar. Do not mix into clean core.
- `research_only`: useful for analysis or evals, not durable product data.
- `reject`: NC, ND, unknown license, commercial textbooks, scraped sites, or
  competitor content.

## Removed One-Off Curation Chain

The old OpenAI batch, import, local repair, and flatten scripts were removed from
the active workflow after producing the final flat dataset. Keep future paid API
curation as an explicit new task rather than a hidden default command.
