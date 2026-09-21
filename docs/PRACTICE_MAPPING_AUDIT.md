# Shared practice mapping audit — 2026-09-21

The small polygons mostly reflect weak or zero topic weights, rather than
unfinished computation. The audit also found and corrected two reproducibility
problems in the same bounded mapping path: batch-dependent embeddings and a
vector-cache ceiling that could permanently stop a large history from finishing.
The seven topics and all projection constants remain unchanged.

Production sampling, pacing, scoring, exploration and goals were not retuned.
The completed policy investigation remains a separate, frozen investigation.
Exactly three independent manual evaluators remain; C gained a mapping mode and
A gained an optional saved-profile input. Neither invokes the other.

## Baseline and retained profiles

The canonical checkout was `C:\Work\caatuu`, `main`, HEAD
`685a109ca9d98c9ed959c8def02f8dbcb1a3c756`, with pre-existing shared changes.
The source freeze predates runtime corrections and records SHA-256 hashes of
runtime modules, course declarations, generated/offline configuration and UI
catalogs. Reports record the pinned model, tokenizer, model revision, installed
CPU libraries/native artifacts and preprocessing/normalization recipe.

The earlier 2/47, 2/14 and 1/3 observations had no saved history snapshots.
Current retained browser histories reproduced those ratios under the old path;
they are reproducible replacements, not proof of identical historical records.
The saved capture contains every public course/game/bank/item history, not a list
constructed from the desired ratios. English sharing never merges evidence.

| Current profile | Distinct retained identities | Positive baseline | Completed zero weights | Rejected English | Unresolved identity / pending / failed vectors |
|---|---:|---:|---:|---:|---:|
| Czech | 47 | 2 | 44 | 1 | 0 / 0 / 0 |
| Mandarin | 14 | 2 | 12 | 0 | 0 / 0 / 0 |
| Spanish | 3 | 1 | 2 | 0 | 0 / 0 / 0 |
| English from Spanish | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| Norwegian Bokmål | 0 | 0 | 0 | 0 | 0 / 0 / 0 |

The rejected practiced meaning is **“small café”**. Its accented letter fails the
existing mechanical English-input guard. It is authored English, so the guard is
overrestrictive for this example; it was not relaxed as part of this audit.
Zero retained identities in the last two profiles does not mean no activities
were ever recorded: activity totals and retained item histories are different units.

Every diagnostic checkpoint assigns each known identity exactly one status:
unresolved identity, English unavailable, evidence unavailable, pending,
vector unavailable, completed unmatched, or matched. Reasons and actual English
rejections are retained. An unreadable bank can leave a known count with unknown
identities; that count is explicitly `unavailableIdentityCount`, never invented IDs.

## Fixed arithmetic and what the shape means

For each encountered identity i and topic j:

```text
k(i,j) = clamp((cos(v_i, a_j) - 0.3) / 0.7, 0, 1)^2
Practice(j) = 1 - exp(-sum_i k(i,j) / 2)
Independent(j) = 1 - exp(-sum_i k(i,j) * e_i / 2)
```

`e_i` means retained independent assessment evidence, including incorrect
attempts made without help. Repeating the same identity does not add another
contribution. Separate banks/directions remain distinct identities even when
they share English. These are evidence masses, not ability, accuracy, recall,
curriculum coverage or completion. Goals do not rewrite recorded evidence.

After deterministic input encoding, the CPU replay still has 2/47, 2/14 and 1/3
positive identities. All five positive identities have maximum weight below
0.01 (an audit description, not a new production threshold):

| Meaning | Cosine to strongest topic | Kernel weight | Contribution |
|---|---:|---:|---|
| good school | 0.315060 | 0.000463 | Home & learning |
| big school | 0.338317 | 0.002996 | Home & learning |
| eat, in each of two Mandarin banks | 0.333070 | 0.002232 each | Food & choices |
| the house | 0.365467 | 0.008747 | Home & learning |

The resulting largest practice radii are 0.001728, 0.002229 and 0.004364
respectively. Small mass, compounded by the squared kernel, explains the nearly
invisible shape. Saturation is not suppressing a large mass in these profiles.
The Mandarin duplicate contributes twice to practice, once to the independent
layer; the two records remain separate. Full per-identity similarities, second
highest similarities, all seven weights, masses and radii are in JSON.

## All-course inspection and explicit denominators

Metadata inspected **17,290 authored records** with **9,759 unique eligible
authored English inputs**. Some authoring records are structural or parent
records, so that is not the playable denominator. The real playable adapters
enumerated **15,844 units**, all checked through the production identity/English
resolver using one primary persistence bank per unit. This inventory denominator
does not expand every alternate assessment direction; real profile replay does
retain all recorded directions.

| Course | Authored records | Playable units checked | Identity resolution | Rejected English identities | Unique eligible playable English | Semantic sample | Positive after correction |
|---|---:|---:|---:|---:|---:|---:|---:|
| Czech | 3,463 | 2,545 | 100% | 15 | 2,364 | 96 / 2,545 (3.77%) | 7 |
| Mandarin | 2,741 | 2,741 | 100% | 15 | 2,117 | 60 / 2,741 (2.19%) | 6 |
| Spanish | 3,526 | 3,342 | 100% | 0 | 2,557 | 84 / 3,342 (2.51%) | 11 |
| English from Spanish | 3,362 | 3,218 | 100% | 0 | 2,447 | 84 / 3,218 (2.61%) | 6 |
| Norwegian Bokmål | 4,198 | 3,998 | 100% | 1 | 2,763 | 84 / 3,998 (2.10%) | 6 |

The 31 script/input-guard exclusions persist. No primary identity was unresolved;
the other 15,813 had eligible English. Per-course unique-English counts are not
additive across courses. English extraction uses the production game adapters,
not target-language text guessed to be English. NFKC/trim preserves case,
punctuation and internal whitespace; the mechanical guard rejects non-ASCII
letters and specified target scripts. These restrictions are explicit in reports.

The semantic sample selects at most 12 units per course/game/kind by seeded SHA-256
priority, with no replacement. Of **408 sampled units**, 406 had usable input:
36 were positive, 370 completed with zero weights and 2 were English-rejected.
No sampled items remained pending or vector-unavailable. 31 of the 36 positives
had maximum weight below 0.01. Five sampled identities contributed to two axes;
none contributed to more. Baseline sampled positives were 32: changes to 36 are
an encoding-reproducibility correction, not evidence of better classification.

The corrected cached run encoded **456 unique inputs**, including anchors,
retained profiles, sampled meanings and the small review set. It did not embed
the full corpus. A separate uncached model probe repeated 11 of those inputs in
five arrangements (55 input evaluations); it is diagnostic work, not learner
evidence. A restarted warm run reused all 456 disk entries, with no new cached
vectors, and agreed within 1e-9 on every profile/sample mass and radius.

## Topic interpretation

Developer descriptions for twelve review meanings were saved before scores.
Eleven exactly matched real catalog English; “excuse me” did not match the
punctuated catalog value and was explicitly left unscored in that review set.
These judgments are diagnostic examples, not validated educational labels.

“School”, “to eat” and “to travel” have understandable strongest topics.
“Weather”, “friend” and “thank you” miss all topics despite being plausible clear
examples. “Tomorrow” is just below the floor at 0.299680. Generic “yes”, “no” and
“maybe” also remain unmatched, which need not be a defect.

Anchor-to-anchor cosines range from 0.301235 to 0.536740. Their shared broad
everyday wording overlaps substantially. Multiple membership is allowed, but
not automatically correct: “money” has small weights on three axes, and “to
travel” has a tiny food/shopping weight alongside its strong travel weight.
Those weak secondary placements should not be treated as confirmed labels.
The full anchor matrix and distributions are in the readable/JSON reports.

## Bounded implementation correction and evidence

The correction makes the existing shared mapping pipeline reproducible and
honest about incomplete work:

- **Batch dependence:** uncached actual-model tests showed component differences
  up to 0.037352 when texts were encoded together versus singly. Reversing a
  fixed batch alone showed zero difference. Cache-miss batching made results
  depend on prior cache contents. The precise internal numerical cause was not
  established. Practice mapping now encodes each text separately inside its
  bounded requests, with a distinct inference-recipe cache key/signature. Old
  cache files are preserved and cannot satisfy the new recipe. Sampling and
  image/index consumers keep their existing recipe. The same shared model and
  serialized queue are retained; completed singleton results survive timeout.
- **Cache ceiling:** a controlled 4,200-identity history previously stopped at
  4,089 mapped identities with 111 pending, including three no-progress passes.
  The facade now retains seven completed similarities per current English input,
  plus bounded raw vectors, instead of filling a permanent 4,096-vector ceiling.
  The same case finishes in nine passes at the test's 512-text cap. Normal app
  calls remain capped at 96 texts, request batches at 24, and shared requests
  at 32. The shared raw-vector LRU remains 256, and pending requests remain bounded.
- **Accounting:** all required topic comparisons must be valid before an identity
  is called unmatched or contributes mass. Missing/incompatible topic vectors
  are unavailable, never evidence of zero similarity. Failed prefixes do not
  monopolize subsequent bounded work; anchors are requested separately from
  item batches. Cancellation releases the caller without overlapping inference.
- **Interface:** the shared English and Spanish catalogs distinguish completed
  nonmatches, waiting items and mapping failures. Completed zero-weight mapping
  is not called a loading failure. Legends/details count distinct items, and
  explain unaided errors and the separation between goals and saved evidence.

Ordinary tests cover cold/warm state, processing order, batch boundaries,
interruption/resume, expired requests, failed/invalid vectors, offline inputs,
eviction, cache recipe invalidation and release of the existing model lock.
The combined runtime/embedding suite passed 41 tests; the final focused reliability
suite passed all eight tests after the timeout/cache-migration follow-up. The
shared UI and evaluator corpus/cache/configuration suite passed 45 tests.
Evaluator A independently passed its 92 software checks and optional real-profile
diagnostic. These are correctness results, not evidence of learning benefit.
The actual uncached corrected model produced **zero** component differences for
reversed order and partitioned requests. No vectors were manufactured in the
semantic reports; controlled vectors are labelled software fixtures only.

The final browser WASM replay completed all five profiles in one bounded pass
each, matched its warm repeat, and exactly matched itself after page reload.
Browser and CPU outputs are reported separately: the corrected browser had
3/47 Czech positives, including “he/she wants” at cosine 0.300348 and weight
0.000000246482, where CPU had 2/47. Mandarin stayed 2/14 and Spanish 1/3.
The browser's extra placement is vanishingly small, not new practice or an ability
gain. Exact CPU/WASM equality is not claimed. Offline/error cases were injected
software tests, not a simulated browser network outage.

An early local capture-page attempt could not load a blob-backed WASM module
under that diagnostic page's CSP. It was a capture-environment failure, not a
semantic nonmatch. The final capture uses the ordinary course embedding realm
and keeps that realm alive. Production CSP was not weakened. No release was
published; the diagnostic page is loopback-only and outside packaged assets.

## Retained artifacts and reproduction

All reports stay under ignored `artifacts/learning-evaluation/`; keep them local
because the saved browser profile contains real retained practice data.

These paths are relative to that local artifact directory; they are not included
in a clean repository checkout:

| Evidence | Local artifact path |
|---|---|
| Source/input freeze | `content/mapping-baseline-20260921/runtime-freeze.json` |
| Saved browser histories | `content/mapping-baseline-20260921/browser-capture.json` |
| Original mapping baseline | `content/mapping-audit-baseline-20260921/report.md` and `results.json` |
| Corrected deterministic report | `content/mapping-audit-deterministic-20260921/report.md` and `results.json` |
| Warm restarted report | `content/mapping-audit-warm-20260921/report.md` and `results.json` |
| Independent evaluator A replay | `stats/mapping-replay-deterministic-20260921/report.md` and `results.json` |
| Browser verification | `content/mapping-audit-deterministic-20260921/browser-verification.json` |
| Final source hashes and correctness checks | `content/mapping-audit-deterministic-20260921/verification.json` |

Saved-history SHA-256:
`2c31a37f0fcb7189af5445b6bf1ac6f5ad43954cec3233c19092966cbd3321fc`.

The intermediate `mapping-audit-corrected-20260921` run preserves the cache-ceiling
fix before discovery/correction of batch-dependent encoding. Its unchanged
cached radii are not evidence of uncached encoder invariance. Frozen old reports
are evidence of their recorded source/cache state, not a claim that the old
batch-dependent implementation had one reproducible cold-cache answer.

Run from the canonical checkout with the established `caatuu-dev` bind at
`/workspace`. The capture page and complete mode instructions are in
[evaluator C](../tools/learning-evaluation/content/README.md); configuration is
[mapping-config.json](../tools/learning-evaluation/content/mapping-config.json).
Use fresh output names; existing reports are never overwritten.

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --mapping-audit --profiles artifacts/learning-evaluation/content/mapping-baseline-20260921/browser-capture.json --reference artifacts/learning-evaluation/content/mapping-audit-deterministic-20260921/results.json --output artifacts/learning-evaluation/content/mapping-repeat
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic --profiles artifacts/learning-evaluation/content/mapping-baseline-20260921/browser-capture.json --name mapping-repeat
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/practice-compass.test.mjs apps/language-runtime/tests/practice-mapping-reliability.test.mjs tools/learning-evaluation/content/semantic-cache.test.mjs
```

Interrupted manual runs resume computationally from complete, signature-checked
per-text cache entries in a new report directory. Already completed profile files
and prior reports remain intact. No scheduled run or dashboard service was added.

## Recommendation and deferred work

Retain the reliability correction and the current production constants. The
remaining small shapes are now explainable. If a next projection experiment is
chosen, compare the present long descriptions with one frozen alternative wording
on a separately reviewed mix of clear examples, legitimate overlaps, generic
phrases and out-of-taxonomy content. Hold threshold and saturation fixed; assess
missed clear examples and inappropriate matches, not a target mapping percentage.

Durable first-response and support evidence remains necessary for future
assessment work. The retained summaries cannot reconstruct all earlier assistance,
first responses or independent-attempt denominators. This objective did not design
or implement that storage system, calibrate proficiency, or demonstrate learning benefit.
