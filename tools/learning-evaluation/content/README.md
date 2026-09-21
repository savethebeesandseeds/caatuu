# Independent content evaluator (C)

## Shared practice-map audit mode

The same entrypoint also audits the actual shared practice polygon. First open
`http://127.0.0.1:8765/language-runtime/static/practice-map-capture.html` in the
browser containing the practice records, click **Capture all course profiles**,
and save the JSON into an ignored artifact directory. This manual, loopback-only
development page reads public history APIs; it is absent from release asset
catalogs. It performs up to three bounded projection passes per course, retains
errors, and captures a warm repeat. Reload the page for a fresh model realm.
Earlier observations without saved histories are not exact historical snapshots.

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --mapping-audit --profiles artifacts/learning-evaluation/content/mapping-baseline-20260921/browser-capture.json --config tools/learning-evaluation/content/mapping-config.json --output artifacts/learning-evaluation/content/my-mapping-run
```

This mode resolves the complete playable inventory using the production facade,
then embeds a seeded sample of at most 12 units per course/game/kind stratum.
Inventory resource IDs are explicitly translated to one primary persistence
bank per playable unit; alternate assessment directions are not expanded into
that denominator. Real profile replay retains every stored bank/direction.
Authored, playable, practiced and unique-English denominators stay separate.

The [configuration](mapping-config.json) fixes the seed, sample bound, request
bound and developer-authored review descriptions. Descriptions are saved before
scores. Every profile/sample JSON contains exact status accounting, raw topic
similarities, weights, masses, radii and repeated-English contributions. Every
inventory JSON contains all primary identities and English rejection details.
The report includes model/tokenizer/backend signatures and input/source hashes.
The production constants and anchors are used directly; no substitute projector.

Use `--reference prior/results.json` to check that completed counts, weights and
radii agree with a frozen run using the same recipe within 1e-9. If the recipe
differs, it records before/after counts and axes instead. It does not compare old UI status names.
Restart interrupted runs with a new output directory: completed per-vector cache
entries are atomic, signature-checked and reused. Prior reports are never
overwritten. Failures leave configuration and completed profile checkpoints for
inspection. A cache miss can require the existing local model; unavailable work
stays explicitly unavailable. Normal gameplay still embeds only encountered
meanings, at most 96 texts per call and 24 per request batch. Practice mapping
encodes each text individually inside that batch because the pinned model's
vectors depend on batch companions. Its recipe has separate browser/disk cache
identity; sampling and image/index encoding retain their existing behavior.
An actual uncached model probe verifies order and partition invariance. This
does not promise bitwise agreement between the CPU and browser WASM backends.

This is a mode of C, not another evaluator. It imports shared utilities, never A
or B. For the diagnosis, limitations and exact retained artifacts, see the
[mapping audit](../../../docs/PRACTICE_MAPPING_AUDIT.md).

This manually invoked inspector measures authored course distributions. It does
not require stats, policy evaluation, learners, goal persistence, telemetry, or a
running browser service. Production selection uses `adaptive-sampling.mjs`
through the shared `adaptive-practice.mjs` game adapter; the original
`content-progression.mjs` selector remains the compatibility path and comparison
baseline. This evaluator does not implement or modify those policies; see the
[runtime/evaluation overview](../../../docs/ADAPTIVE_LEARNING.md).

## Run in the existing container

From the canonical `C:\Work\caatuu` checkout on `main`, first inspect the existing
container's mount and state. `/workspace` must bind that checkout and the
container must already be running. Do not create another environment.

```powershell
docker inspect caatuu-dev --format '{{json .Mounts}} {{json .State.Status}}'
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs
```

Default: full metadata traversal of all manifest-declared course banks; independent
semantic inspection of up to 384 unique English documents. The default seed and
all controls are in [config.json](config.json). Nothing is installed or fetched.
The pinned model and the existing container dependencies must be available.

```powershell
# Small stable fixture, with deliberately missing data and unavailable banks.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture

# Full metadata only; no model loading or embedding-cache access.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --no-semantic

# Reproducible larger inspection, limited to explicitly named courses.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --courses cz,es-en --seed review-2 --max-documents 768

# New output directory; existing reports are never overwritten.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture --output artifacts/learning-evaluation/content/my-fixture

# Focused software correctness checks, independent of model downloads/encoding.
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/content/corpus.test.mjs tools/learning-evaluation/content/semantic-cache.test.mjs tools/learning-evaluation/content/metrics.test.mjs
```

`--config path.json` accepts the complete configuration shape, not a partial
patch. CLI flags override its seed, courses, semantic size or mode. `courses: []`
means all courses; unknown course IDs fail. `maxDocuments` ranges from 0 to 4096,
and pair work is at most `n(n-1)/2` within the selected documents. This computational
bound is not a curriculum threshold. Metadata is never downsampled. A zero
semantic budget verifies the signature but performs no comparisons; use
`--no-semantic` to avoid model access entirely.

Each invocation writes `corpus.json`, `results.json`, and `report.md` to a new
directory under ignored `artifacts/learning-evaluation/content/`. The default
directory includes UTC time and PID. The cache is also under this area's ignored
directory. No default tests, CI, release gates, schedules, telemetry, dashboards,
or services run the inspector. No central test-registration change is required
for these commands; the integration owner can register only the focused
correctness tests if desired, never the exploratory runs or diagnostic thresholds.

A semantic failure writes the completed metadata and a `blocked` semantic
section, then exits nonzero. A failed game adapter preserves authoring inventory,
reports its error, sets its playable count to `null`, and makes aggregate playable
totals explicitly incomplete. That is a data finding, not an excuse to count raw
records as playable. There are no pedagogical pass/fail gates.

## Shared corpus API and counting units

[corpus.mjs](../shared/corpus.mjs) is importable without executing C or loading the
model. It exports:

- `loadEvaluationCorpus({root, courses})`: manifest-driven filesystem capture.
- `buildEvaluationCorpus(catalogs, {sources, naturalizationValidator, courses})`:
  pure fixture/adapter capture. Input catalogs have the same shape as
  `loadProgressionCatalogs()`, optionally with a Word World `runtime` projection.
- `englishAuthority(catalog, progressionRecord)`: explicit field selection.
- `CORPUS_SCHEMA_VERSION` and `CORPUS_ADAPTER_VERSION`.

The returned value contains `courses`, `records`, `playableUnits`, `documents`,
`findings`, `sources`, and `adapters`. `sources` are actual SHA-256 file hashes of
manifests, authoring catalogs, used runtime projections and adapter implementations.
The loader compares repeated manifest/catalog reads and rejects detected changes
during capture; it does not lock the shared checkout. The run adds configuration
and evaluator implementation hashes and the current commit ID. Uncommitted
sources are therefore identified by bytes, not just by commit.

| Population | Meaning and identity |
| --- | --- |
| Authored records | Every `progressionRecords()` record; includes parents and nested records. ID is a JSON tuple of course/game/bank/source location. Location identity is for this inventory, not a persistence API. |
| Playable assessment units | Static candidates admitted by the actual game adapter below. Learner identity is the separate course/game/bank/item tuple. Runtime positional fallback IDs are explicitly marked and require the source hash. |
| Semantic documents | One document per exact canonical English input; ID is `english:` plus SHA-256 of that text. `recordIds` retain every authored provenance reference. No learner evidence is joined. |

Records include `kind`, `recordRole` (`parent`, `nested`, `leaf`), `parentId`,
`source.path/location`, raw `metadata`, `english.text/field/reason`, translation
missingness, categories and their provenance, and `semanticDocumentId`.
`recordRole=parent` takes precedence for structural containers that are themselves
nested; `parentId` still retains that relationship. `progressionRecords()` links
Grammar Gravity examples to their challenge, with the exact form path retained
in the source location.

Units contain `recordIds`, `learnerIdentity`, their runtime `normalizer`, normalized
metadata and unit kind. Authored and normalized metadata are reported separately:
defaults must not conceal missing authoring. Record-kind subtotals associate units
through `recordIds`, since authored and assessment kind names differ. Shared
English documents can appear in several bank/course subtotals; those document
counts are not additive.

## Per-game adapters and English authority

| Bank | Actual playable adapter and unit | English authority |
| --- | --- | --- |
| Verb Nebula (`verb-lab`) | `extractCoreVerbPairs`; one normalized matching pair. Nonverbs, malformed rows and duplicate pairs filtered by the runtime remain authored records only. | `englishAuditText`, `english`, `en`; `source` only when the course's learner-base locale is English. |
| Word World (`word-net`) | Czech `StandardWordWorldProvider`, or modern `joinConceptCatalogs`; one admitted sentence, with playable-target count recorded separately. Missing runtime projections never imply playability. Text and grades must match authoring. | Authored `englishText`, never translated learner-base text. |
| Conjugation Comet | `validateConjugationCometCatalog` and `buildConjugationHelixRound`; one helix subject/form assessment, namespaced by verb/form ID. Paradigm groups and parent meanings are not extra helix units. | `englishAuditText`; legacy unversioned Czech only uses `meaning` for parents and `cue` for forms. |
| Case Cosmos | Existing `buildRounds` and `buildQuestions` at all authored badge levels; one case context/question. | Context `english`; structural paradigms have no independent English authority. |
| Grammar Gravity | `buildGrammarGravityRounds` at badge 3 with fixed RNG; one generated bilingual example candidate. | Example `englishAuditText`; challenge/form containers have no independent English. |
| Grammar Gravity nouns | `normalizeNounLandingPack`; one noun-category candidate. | `english`. |
| Sound Quasar | `validateSoundQuasarCatalog`; one listening word or sentence candidate. Audio/review readiness remains a separate runtime/publication concern. | `englishAuditText`. |
| Naturalization Nucleus | Existing `CaatuuNaturalizationNucleus.validateCatalog`; one character puzzle. The trusted local classic script is evaluated in an isolated VM to access its validator without mounting the game, DOM or network. | `translation` only for the existing Mandarin course with English learner base. |

An unsupported/new field contract needs an explicit adapter; no heuristic uses
target or learner-base text as English. A structural missing-English finding is
informational. Explicit English rejected by the runtime script guard is reported
separately from absent English. Rejection is not evidence that the text is not
English; provenance, not automatic language detection, establishes authority.

Category extraction reports existing topic/category/tags, family, lane, case,
grammar and related authoring labels where present. `categoryProvenance` identifies
direct item fields versus inherited parent focus or declared axis features.
Missing categories are measured against fields actually observed in a scope;
the evaluator does not require a universal taxonomy. Metadata usefulness and
complexity are integers 1–100; difficulty badges are 1–3 where supported.
`urgency` and `subdifficulty` are legacy fields and never substituted as authored
modern grades.

## Metrics and limits

`metrics.mjs` exports pure `inspectMetadata`, `inspectSemantics`,
`selectSemanticDocuments`, `numericSummary`, `gradeDistribution`, and
`categoryDistribution`. `report.mjs` exports `renderReport`; `run.mjs` exports
`run`, `parseArgs`, and `validateConfig` and executes only when invoked directly.

| Metric | Definition, denominator and limits |
| --- | --- |
| Grade distribution | Valid integer counts, missing/invalid counts, bins, min/max, interpolated quartiles, mean and population standard deviation. All authored records or separately normalized playable units within each scope. Optional missing badges are not automatically defects. |
| Category concentration | HHI = sum of squared category proportions. Denominator is tag occurrences, each unique tag counted once per record. Multi-tag records can contribute multiple occurrences. |
| Category dispersion | Shannon entropy in natural-log units and `exp(entropy)` effective category count. Taxonomy and size dependent; no recommended target value. |
| Exact duplicates | Authored references to the same NFKC-trimmed, case/punctuation/internal-whitespace-preserving English input. Includes authored English rejected by the embedding guard; those text keys have no semantic-document ID. All-corpus calculation; no embedding sample required. Within-bank/kind duplicate grade spreads are retained separately. |
| Semantic inspection | Sort unique document IDs by SHA-256 of `[seed,id]` and take the first `maxDocuments`. Order invariant, reproducible, without replacement. It is a global document sample, not stratified or weighted by number of learner items. Coverage per bank is recorded; small banks may have no inspected document. |
| Near neighbors | All pair cosines among inspected unit vectors. Examples above configurable `nearSimilarity`, plus each inspected document's nearest inspected neighbor. This is not nearest-neighbor search over unsampled documents. |
| Semantic concentration | Mean off-diagonal pair cosine and squared norm of the mean vector. Different content types and sample sizes change interpretation. Singleton concentration is 1 and does not establish course concentration. |
| Semantic dispersion | Mean cosine distance to the normalized centroid; undefined for an empty or zero centroid. |
| Within-corpus sparsity | Distribution of `1 - maximum neighbor cosine` and number below the similarity inspection threshold. Undefined for fewer than two vectors. Strongly size sensitive: fewer candidates generally means larger nearest-neighbor distances. |
| Related grade spread | Complexity/badge max-minus-min across English-near pairs within the same course/game/bank/authored kind; only valid authored grades. Shared English does not make target grammar/pronunciation equivalent. |
| Potential abrupt gaps | Empty intervals between distinct authored complexity values within a bank/kind or one existing category; additionally large grade spreads among inspected related pairs. All are labelled diagnostic candidates. Sorting grades does not claim to reproduce the production learning path. |

Default diagnostic controls (`nearSimilarity=.75`, `complexityGap=25`,
`difficultyGap=2`) are adjustable inspection settings, not learned thresholds,
curriculum recommendations, tests or release gates. Examples are bounded by
`exampleLimit`; candidate totals retain their full denominators. Metadata JSON
retains complete distributions and category spreads. Counts, observed category
richness, entropy, extreme grade spreads, nearest-neighbor distances and isolation
are size sensitive. Compare seeds/sample sizes and source hashes before comparing
reports; no cross-run significance claim is made here.

No aggregate course-quality score is defined. No comparison of learning outcomes,
adaptive policies, activity counters or mastery is performed. The optional Czech
semantic compass is an authored topic summary with dimensions distinct from
embedding coordinates. Similarity must never grant mastery or unrestricted
transfer. Repeated English meanings can be intentional practice of different
target-language grammar/pronunciation, not pedagogical redundancy.

Missing topics are assessed only with `--reference path.json`, containing an
explicit field and expected values, optionally scoped by course/game/bank:

```json
{"field":"topic","expected":["food","movement"],"courseId":"cz"}
```

The reference is hashed and reproduced in JSON. Without it, coverage is explicitly
`not-assessed`. These example labels are illustrative, not a proposed curriculum.

## Cache and integration ownership

[SEMANTIC_CACHE.md](SEMANTIC_CACHE.md) documents the independently importable
semantic utility, exact compatibility signatures, offline container recipe,
cache format/counters and a proposed browser reader. No older Czech SQLite or
image-index vectors are reused without compatibility evidence. The current
implementation reuses its own verified cache entries only.

This task owns only `content/**`, `shared/corpus.mjs`, and
`shared/semantic-cache.mjs`. The integration owner retains production sampling,
learner-state/evidence and goals, existing hosts/profile, browser reader, shared
asset registration and publication. Runtime schemas remain behind these narrow
adapters. If those schemas change, update the adapter and correctness fixture;
do not implement a parallel production component here.

See [HANDOFF.md](HANDOFF.md) for actual executed commands/results and any remaining
integration work. Generated reports and caches stay ignored and are not release
artifacts.
