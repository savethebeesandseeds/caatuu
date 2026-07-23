# Word World Standard Corpus v0.1

This directory is the canonical authoring source for the model-free Word World
`Standard` content provider. It is intentionally separate from model-training
datasets. The Standard provider must be able to show Czech text, reveal an
included English meaning, choose by difficulty, and branch from an exact Czech
surface form without invoking a language model.

## Review status

The corpus contains **Codex-reviewed** records. It does not claim native-speaker
or other human approval. `review.status` is `codex_reviewed` and
`review.humanApproved` is `false` on every compiled record. These fields must
not be changed merely to advance a release; human approval requires a separate,
recorded review process.

The seed comes from the 500-row Caatuu-authored common-phrase bank. Eight rows
with clear Czech-naturalness or bilingual-equivalence problems are rejected,
and three exact-Czech duplicate groups are merged while preserving alternate
English meanings. The 5,000-row template curriculum is deliberately not
imported into this corpus seed.

An independent blind Codex pass recorded and resolved 59 findings. A fresh
independent re-audit of all 489 corrected records then found 17 bounded
residuals, including six stale grammar-guidance records; seven of those rows
had also changed in the first pass. The combined receipt covers 69 distinct
corrected source rows, 58 final text changes, 24 difficulty changes, and the
two review origins. It is stored at
`reports/blind-review-2026-07-21.json` and preserves original and resolved
content, rationale, reviewer role and the explicit `humanApproved: false`
caveat.

The first Codex-authored expansion contributed 250 isolated candidate records.
A separate blind reviewer passed 219 unchanged records and held 31 rows with
naturalness, equivalence, metadata, or semantic-duplicate findings. Only the
219 passing rows are present in `source/codex-expansion-0001-reviewed.jsonl`:
49 are Level 1 and 170 are Level 2. The original candidate JSONL and blind
review remain immutable evidence in `candidates/`, together with
`codex-expansion-0001.promotion-receipt.json`, which locks their hashes, every
promoted and held ID, the output hash, and the explicit
`humanApproved: false` state. The project-owned original bilingual batch uses
no external corpus text and is released under the same explicit MIT corpus
source license as the Caatuu common-phrase bank.

The first dedicated Level 3 batch contributed 80 frozen candidates. Its
separate adversarial Czech-English and pedagogy review marked 52 rows as both
`pass` and `safeToPromote: true`; the other 28 remain held and unmodified.
Only those 52 approved rows are present in
`source/codex-level3-0001-reviewed.jsonl`. The frozen candidate, blind review,
and `codex-level3-0001.promotion-receipt.json` preserve the evidence hashes,
every promoted and held ID, the reviewer role, the MIT licensing decision, and
the explicit `humanApproved: false` state.

## Authoring contract

`schema/record.schema.json` documents the unified multilingual JSONL record.
The canonical language fields are `languages.en` and `languages.cs`; new
languages can be added through a later schema version without flattening or
duplicating the learning record.

Every record includes:

- difficulty, CEFR, topic, objective, skill focus, age band, progression and
  support flags;
- exact Czech token annotations with surface form, normalized form, token
  position and whether the token is a useful branch target. Function-only
  formulas remain valid with zero playable targets; the importer never invents
  a branch target;
- grammar focus and clause count;
- an embedding-friendly scene query plus optional manually selected asset IDs;
- source provenance and an honest review state.

`rubric.json` is executable policy, not prose only. Level 1 is limited to one
tiny thought and at most five Czech and five English tokens. A courtesy or
vocative comma does not create a second clause. Level 2 is the main learning
volume and must represent at least 60% of the bank. Level 3 permits richer but
still bounded learner language and must contain at least 50 independently
accepted records. Falling below that real-content floor is a validation error.

The combined corpus has 175 level-1 records, 533 level-2 records, and 52 level-3
records. Level 2 remains 70.1% of the bank. This is an intentional
guided-learning distribution, not an inference from sentence length alone:
modal/reflexive forms, past tense, possessives and multi-part instructions were
moved out of first contact even when they happened to be short.

## Adding independently reviewed batches

Place each accepted batch in `source/` as its own JSONL file. Keep IDs and
provenance source IDs globally unique. The validator and compiler discover all
JSONL files recursively and sort files and records deterministically, so adding
`source/codex-batch-0001.jsonl` does not require changing either tool. Candidate
and rejected rows belong outside `source/` until accepted.

For reviewed subsets, preserve the complete candidate and review report as
immutable evidence. Promote only explicit passing verdicts, record the exact
input and output hashes and held IDs in a promotion receipt, and require a new
independent review before any corrected held row may enter `source/`.

Exact English reuse across different records is allowed because formal,
informal, gendered and morphology-focused Czech variants can share one English
rendering. Exact Czech reuse is not allowed: equivalent Czech records must be
merged and alternate English meanings retained in one record.

## Rebuild and verify

Run every command in the repository container:

```powershell
docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/import-word-world-common-phrases.mjs

docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/promote-word-world-reviewed-expansion.mjs

docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/promote-word-world-reviewed-level3.mjs

docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/validate-word-world-standard.mjs

docker compose --profile dev run --rm caatuu-dev `
  node tools/czech-ml/scripts/build-word-world-standard.mjs

docker compose --profile dev run --rm caatuu-dev `
  node --test tools/czech-ml/tests/word-world-standard.test.mjs
```

The compiler emits:

```text
apps/languages/czech/static/data/word-world/manifest.json
apps/languages/czech/static/data/word-world/standard-v0.1/records.json
```

The manifest's `runtimeFile` is relative to the manifest directory. The runtime
pack is minified and includes records in ID order. Its SHA-256 covers the exact
file bytes, including the final newline.

## Coverage is a product gate

`reports/coverage.json` contains difficulty, CEFR, topic, grammar, skill and
support distributions plus every playable target's sentence count. A target
is `branchable` at two records and `strong` at five. These names are coverage
signals, not claims that the seed is complete. Difficulty counts are also
release gates: Level 1 stays strict, Level 2 stays the majority, and Level 3
must keep its independently reviewed minimum. The corpus has broad phrase
variety but many single-use target forms; future Codex batches should be chosen
from this deficit report rather than generated at random.
