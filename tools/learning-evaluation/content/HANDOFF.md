# Evaluator C handoff

Implemented in the canonical `C:\Work\caatuu` checkout on `main`. The existing
`caatuu-dev` container was initially stopped; after the user started it, its
running state and `C:\Work\caatuu` → `/workspace` bind were verified. No services,
container configuration, branches, worktrees, commits or publication were changed.
Concurrent runtime/learner/policy work was preserved.

## Changed files and public interfaces

Only these new, assigned files belong to this work:

- `tools/learning-evaluation/shared/corpus.mjs`
- `tools/learning-evaluation/shared/semantic-cache.mjs`
- `tools/learning-evaluation/content/run.mjs`
- `tools/learning-evaluation/content/config.json`
- `tools/learning-evaluation/content/fixture.mjs`
- `tools/learning-evaluation/content/metrics.mjs`
- `tools/learning-evaluation/content/report.mjs`
- `tools/learning-evaluation/content/corpus.test.mjs`
- `tools/learning-evaluation/content/semantic-cache.test.mjs`
- `tools/learning-evaluation/content/metrics.test.mjs`
- `tools/learning-evaluation/content/README.md`
- `tools/learning-evaluation/content/SEMANTIC_CACHE.md`
- `tools/learning-evaluation/content/HANDOFF.md`

Corpus exports: `loadEvaluationCorpus`, `buildEvaluationCorpus`,
`englishAuthority`, `CORPUS_SCHEMA_VERSION`, `CORPUS_ADAPTER_VERSION`.
Cache exports: `canonicalEnglishInput`, `semanticCacheKey`,
`validateSemanticVector`, `loadPinnedSemanticModel`, `createSemanticCache`,
`SEMANTIC_CACHE_SCHEMA`, `PREPROCESSING_VERSION`, `NORMALIZATION_VERSION`.
Metrics, report and CLI exports and complete schemas are documented in
[README.md](README.md) and [SEMANTIC_CACHE.md](SEMANTIC_CACHE.md). Both shared
modules can be imported without executing C. No evaluator invokes another.

## Actual checks and runs

Executed in the existing container:

```powershell
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/content/corpus.test.mjs tools/learning-evaluation/content/semantic-cache.test.mjs tools/learning-evaluation/content/metrics.test.mjs
```

30/30 tests passed. After the final text-duplicate adjustment, the changed
metrics/report/config suite was rerun independently: 11/11 passed. The unchanged
corpus and cache suites had passed 9/9 and 10/10 respectively. Tests cover actual
runtime filtering, nested authoring, English provenance, separate learner IDs,
cache signature invalidation/corruption/concurrency/confinement, known vector
geometry, deterministic sample selection, missing data and incomplete counts.
Tests inject tiny labelled vectors where appropriate; those are not presented
as production embeddings.

```powershell
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/content/metrics.test.mjs
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture --no-semantic --output artifacts/learning-evaluation/content/fixture-metadata
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture --output artifacts/learning-evaluation/content/fixture-semantic
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture --output artifacts/learning-evaluation/content/fixture-final
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --output artifacts/learning-evaluation/content/full-inspection
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --output artifacts/learning-evaluation/content/full-replay
```

All listed commands completed successfully. Output directories already exist;
omit `--output` or use a new directory when repeating. Each holds Markdown/JSON
results and a provenance-preserving corpus snapshot. Earlier smoke artifacts
capture their then-current implementation hashes; the authoritative final full
report is `artifacts/learning-evaluation/content/full-replay/report.md` with
adjacent `results.json` and `corpus.json`.

Fixture result: 16 authored records, 7 confirmed playable units and 10 semantic
documents. Two deliberately incomplete banks have unavailable playable counts,
and missing metadata/translation cases are reported. The first real-model fixture
run embedded 10 documents; the repeated fixture reused all 10 without new
embedding. Its earlier metadata-only run accessed no model.

Full result: 17,290 authored records; 15,844 normalized playable assessment
units; 9,759 eligible unique English documents; all 29 bank adapters successful.
Every authored record has valid usefulness and complexity; 5,566 records lack an
optional difficulty badge. No missing target or learner-base translation was
detected under these adapters' definitions. There are 315 structural records
without independent English and 31 authored English inputs excluded by the
existing script guard (including accented proper names and “café”). English
text-only duplicate inspection includes the latter even though embedding does
not. Final duplicate groups: 3,280, involving 10,466 authored records.

Semantic sample: seed `content-inspection-v1`, 384 documents, 73,536 pair
comparisons, 9,375 eligible documents outside the inspection budget. The first
full run embedded 383 vectors and reused 1; the full replay reused all 384,
embedded 0, and skipped 0 selected documents. The final result includes the exact
sample IDs, 70 source/config/implementation hashes, verified model/tokenizer
signatures, recipe and cache counters. The provider verified 12 pinned assets
and 2 native ONNX backend files: Transformers 4.2.0, ONNX 1.24.3, 384 dimensions.

Observed sample: 13 near pairs at the configured 0.75 inspection threshold;
mean pair cosine 0.1247; centroid norm squared 0.1270; mean cosine distance to
centroid 0.6436; median nearest inspected-neighbor distance 0.5039. These values
are sample-dependent descriptions, not course quality judgments. There were
24 authored complexity-interval candidates and no related-pair grade-gap
candidates in this sample. No learning-policy, learner-outcome, universal-topic,
or pedagogy comparison was executed or claimed.

Read-only assertions compared `full-inspection/results.json` with
`full-replay/results.json`: selected document IDs, verified model signature and
all semantic metrics matched exactly, and the replay counters confirmed 384 disk
reuses and zero embeddings. The first and final text-duplicate totals differ
because the final metric additionally includes authored English rejected by the
encoder; no semantic result was recomputed or retrospectively changed.

Repository checks also completed successfully:

```powershell
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
git diff --check
git check-ignore artifacts/learning-evaluation/content/full-replay/results.json artifacts/learning-evaluation/content/cache
git branch --show-current
git for-each-ref --format='%(refname)' refs/heads refs/remotes
git worktree list --porcelain
```

File policy passed for 2,783 tracked/candidate files; Markdown links passed for
189 files; diff whitespace check passed; report/cache paths are ignored. Final
refs were only `refs/heads/main` and `refs/remotes/origin/main`; the canonical
checkout was the only registered worktree. Other sessions' modified and new
runtime files remain untouched. Counts are observations of this shared checkout,
not fixed expectations for future repository tests.

## Integration needs and limitations

No implementation blocker remains. No central test registration was modified or
is required for the manual entry points. If desired, the integration owner can
register only the three focused correctness files; do not register evaluator
runs, thresholds, or generated reports in CI/default tests/release gates.

Production browser reading, asset registration/publication, learner history and
evidence, goal UI/persistence and sampling remain integration-owner work.
[SEMANTIC_CACHE.md](SEMANTIC_CACHE.md) supplies the versioned data format and a
browser-reader proposal. Its Node cache module is not a browser module. Similar
English vectors never grant mastery or evidence transfer.

The 31 script-guard exclusions are reported as an existing runtime compatibility
limitation, not silently transliterated, translated or fixed here. No older
Czech SQLite or image-index vectors were assumed compatible. The source snapshot
does not lock the concurrently edited checkout, and the recorded hashes are the
authority for what each run inspected. Small semantic samples can miss rare
banks/topics or make content appear sparse; bank coverage is included. Missing
topics are not assessed without an explicit reference. Structural inventory,
playable assessment units and English documents must retain separate denominators.
