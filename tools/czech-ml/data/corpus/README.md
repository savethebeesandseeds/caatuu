# Caatuu Czech Corpus

This folder holds the seed corpus for Czech spelling, diacritics, learner
phrasing, and later model experiments.

From Debian:

```bash
cd /workspace/tools/czech-ml
npm run build:corpus
```

Use `--refresh` to refetch remote sources, or `--skip-remote` to rebuild only
from local Caatuu app data:

```bash
npm run build:corpus -- --skip-remote
```

## Outputs

- `processed/czech_seed_corpus.jsonl`: document-level corpus rows with source
  metadata.
- `processed/czech_seed_sentences.txt`: deduplicated sentence list for spelling
  and diacritic checks.
- `processed/attribution.json`: source, URL, and license metadata for each
  document row.
- `processed/summary.json`: current counts.
- `raw/`: cached raw remote sources.

## Source Policy

- Caatuu local data is project-local and safe to use for app-specific training
  experiments.
- Czech Wikipedia extracts are CC BY-SA. Keep attribution and do not mix them
  into redistributable model/data artifacts without handling share-alike
  obligations.
- Project Gutenberg text is included only as a small book-style sample. Check
  local reuse requirements before redistributing.
- Do not use this broad corpus as final learning content without review. It is
  source material, not polished Caatuu copy.
