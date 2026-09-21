# English semantic cache utility

`../shared/semantic-cache.mjs` is importable independently of every evaluator.
Importing it loads no model, runs no evaluation, and writes no files. It has no
learner, policy, stats, course-goal, or browser-service dependency.

## Public API

- `canonicalEnglishInput(text)` returns NFKC-normalized, trimmed text accepted by
  the existing English MiniLM runtime boundary. Case, punctuation, and internal
  whitespace are preserved. The runtime rejects missing/overlong text, non-English
  letters, and text without an ASCII letter. This is a mechanical script guard,
  **not language detection**; the corpus adapter must supply English provenance.
- `semanticCacheKey(text, signature)` hashes canonical text, the complete model
  signature, schema, preprocessing version, and normalization version.
- `loadPinnedSemanticModel({root})` verifies the shared runtime catalog's hashes
  against actual artifact bytes and returns `{signature, encode(texts), dispose()}`.
  It checks the installed Transformers version against the repository's exact
  package pin. The signature includes model and tokenizer artifacts, configuration,
  package and module-entry hashes, ONNX native-artifact hashes, Node version,
  platform/architecture, and the CPU recipe. The encoder loads only on `encode`.
- `createSemanticCache({root, directory, model, batchSize=32})` returns
  `{signature, signatureHash, directory, embed(documents), stats(), dispose()}`.
  `root` defaults to the repository root, and `directory` defaults to
  `artifacts/learning-evaluation/content/semantic-cache`. Custom directories must
  remain below `artifacts/learning-evaluation/<area>/`. The model may be injected
  for a focused correctness fixture; such results are not production embeddings.
  Directory ancestors and cache entries must not be symlinks. Existing ancestors
  are checked before access and again after directory creation, before writing.
- `validateSemanticVector(vector, dimension)` validates numeric, finite,
  dimension-matched, nonzero, normalized vectors and returns a float32 number
  array. Squared L2 norm tolerance is 0.002, a serialization correctness tolerance.
- Constants: `SEMANTIC_CACHE_SCHEMA`, `PREPROCESSING_VERSION`,
  `NORMALIZATION_VERSION`.

`embed([{id, englishText}])` preserves each caller ID and returns
`{rows, skipped, stats}`. Each row contains `{id, englishText, key, vector, cache}`;
`cache` is `embedded` or `reused`. Input documents are never mutated. Identical
canonical English inputs share one vector while their caller IDs remain distinct.
No course/game/bank/item evidence is merged or inferred. `skipped` contains
`{id, reason, detail}` for invalid IDs or English input. Encoder failures propagate
as errors; they are not silently reported as a successful semantic inspection.

```js
import { loadPinnedSemanticModel, createSemanticCache } from "../shared/semantic-cache.mjs";
const model = await loadPinnedSemanticModel();
const cache = await createSemanticCache({ model });
try {
  const result = await cache.embed([
    { id: "course-a/game/bank/item", englishText: "The cat sleeps." },
    { id: "course-b/game/bank/item", englishText: "The cat sleeps." },
  ]);
  // Two identities, one semantic vector. No learner knowledge estimate follows.
  console.log(result.stats);
} finally { await cache.dispose(); }
```

## Recipe and compatibility

The provider reuses `EnglishMiniLmRanker` and the established
`build-image-embedding-index.mjs` recipe: the existing container's pinned
Transformers package, local-only `feature-extraction`, CPU, `dtype: fp32`, the
pinned `model_qint8_arm64` filename, mean pooling and L2 normalization. The dtype
option matches the existing recipe; it does not rename or replace the quantized
model artifact. No package installation, model download, or asset publication is
performed. Source/model asset verification itself does not load the ML engine.

Cache reuse requires exact canonical input and the complete verified signature.
The older Czech SQLite index and current shared image index are **not imported**:
model ID or dimension alone cannot prove tokenizer/preprocessing/backend recipe
compatibility. Future importers must verify all those fields, original canonical
text, and vector integrity before admitting any entry. Backend/platform signature
changes intentionally cause conservative misses even if embeddings are close.

Each entry is one JSON file at `<directory>/<key-first-two>/<key>.json`:

```json
{
  "schema": "caatuu-learning-semantic-cache-v1",
  "key": "sha256-of-canonical-input-and-complete-signature",
  "englishText": "The cat sleeps.",
  "signatureHash": "sha256-of-stable-serialized-signature",
  "signature": { "modelId": "...", "inputLanguage": "en", "dimension": 384 },
  "preprocessingVersion": "english-authority-nfkc-trim-runtime-guard-v1",
  "normalizationVersion": "minilm-mean-l2-float32-v1",
  "encoding": "number-array-float32",
  "vector": [0.01, 0.02]
}
```

The example signature and vector are abbreviated, not a valid cache fixture.
Actual signatures contain all fields listed above, and actual vectors have 384
dimensions. A reader checks schema, exact text/key, both version fields, full
signature and its hash, encoding, dimension, finite values, and L2 norm. Invalid
entries are counted and rebuilt; permission and I/O failures propagate. Writes
use a uniquely named temporary file and atomic rename per key. Independent
processes can repeat equivalent computation but never rewrite a shared aggregate
index or expose a partially written JSON entry. Interrupted temporary files are
ignored. One cache instance serializes its calls.

## Counters and limits

Stats are cumulative for the cache instance: `requestedDocuments`,
`eligibleDocuments`, `skippedDocuments`, `uniqueCanonicalInputs`, `embeddedVectors`,
`reusedVectors`, `diskReusedVectors`, `memoryReusedVectors`, `duplicateDocuments`,
`invalidCacheEntries`, and the `skipReasons` frequency map. Embedded counts are
unique cache misses actually computed, not learner units. Duplicate documents in
one new-input batch use the same pending vector and are counted as duplicates,
not as extra computations or cache reads. Reuse counts count cache reads, which
can include multiple documents for an already cached input. Document totals and
vector totals therefore describe different populations.

The cache makes no semantic thresholds, mastery claims, transfer grants,
curriculum recommendations, or quality scores. It neither checks topic coverage
against an unstated reference nor equates English similarity with equivalent
target grammar/pronunciation. Preprocessing and backend signatures are necessary
compatibility evidence, not proof of identical performance across machines.

## Integration and checks

This Node filesystem provider is not browser-safe. The integration owner can
implement a pure browser reader for an explicitly published, versioned artifact:
validate an expected full signature, keep vectors keyed by semantic cache key,
and accept a separate mapping from learner item IDs to semantic keys. It must
keep learner evidence separate and must not infer mastery from similarity.
Browser asset registration and publication remain integration-owner work. No
production reader or runtime file is changed here.

Run focused software checks manually in the established container:

```powershell
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/content/semantic-cache.test.mjs
```

Tests inject a labelled three-dimensional encoder fixture. They check exact text
identity, signature invalidation, independent evidence IDs, lazy compatible-cache
reuse, corruption handling, invalid input/vector rejection, output confinement,
and concurrent complete-file writes. They do not establish production embedding
quality. Production smoke runs belong to the content runner and must record the
actual pinned signature and compute/reuse/skip counts. No default test, CI,
release-gate, scheduled run, telemetry, or dashboard registration is added.
