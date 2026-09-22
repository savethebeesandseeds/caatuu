# Adaptive practice and manual evaluation

The learning loop connects completed interaction evidence, the existing
course/game/bank history, the selected learning goal, and the next exercise.
It preserves the [content progression contract](CONTENT_PROGRESSION.md):
exposure, assistance, independent responses, delayed practice and assessment
directions remain distinct. There is no new learned model or training service.

## Runtime and representation

[adaptive-sampling.mjs](../apps/language-runtime/static/source/games/adaptive-sampling.mjs)
scores eligible items using authored usefulness, goal relevance, recent independent
errors, missing evidence, challenge, novelty, due review, recency and optional
English semantic features. Difficulty badges select one exact authored level; usefulness
and complexity are editorial 1–100 grades, not measured learner probabilities.
Static importance uses usefulness; review urgency comes from history. Missing
features remain explicit and contribute zero rather than fabricated precision.

The selector retains gradual challenge expansion, daily introduction pacing,
review/practice/new slots and distinct-answer requirements. Within each available
slot it mixes score softmax with uniform exploration: normally 15%, or 25% for
Explore. Small banks may relax pacing/frontier limits to remain playable, never
the selected difficulty. Recent/excluded items yield to alternatives within the available
category; exhausted categories have explicit fallback explanations.
The difficulty filter runs before progression, history and scoring: Explorer
selects level 1, Traveler level 2, and Navigator level 3. Older reviews and
semantic suggestions cannot introduce a different level. Empty bands stay empty;
sparse bands never borrow another difficulty. Changing a badge replaces active
practice, while completed evidence remains available in Stats across all levels.

[learner-state.mjs](../apps/language-runtime/static/source/learner-state.mjs)
adapts real history without changing persistence. It reports retained evidence,
due time and heuristic practice readiness. Production recall, knowledge and
independent-accuracy probabilities remain null: public history lacks a reliable
independent-response denominator and a calibrated forgetting model. An unassessed
item is unknown, not assessed-and-weak. Exposure, XP and assisted success never
become proof of knowledge. Explicit supplied probabilities are supported for
independent simulation through the same policy interface.

## Goals and public interfaces

Backpack → Stats offers optional Balanced, Reinforce, Explore, Review and
authored course topics. Balanced is the default; difficulty remains separate in
Items. Goal changes apply when the next practice selection is made; an already
assembled board is preserved. The direction card describes this future intent
separately from the recorded-practice polygon above it.
All five current course manifests provide optional `learningGoals`; courses may
omit it. Each entry has exactly `id`, learner-base `label`, English `embeddingText`
and `categories` matching existing course topics. The contract permits at most
12 goals and 1–32 category IDs per goal; it validates IDs, text and the English
script boundary. English authorship remains a provenance requirement, not language
detection. Topic goals are independent of the shared practice compass: category
labels, shared topic dimensions and MiniLM coordinates are different representations.

`CaatuuLearning.goalOptions()`, `goal()` and `setGoal(id)` expose the selection;
topic IDs use `topic:<authored-id>`. The course-scoped `learning.goal.v1` preference
is separate from older difficulty preferences. Unknown stored IDs fall back to
Balanced. `samplingContext(gameId, bankId, assessmentDirection)` supplies identity,
the selected goal and the course's embedding capability.

## Shared course Stats

Every course uses one practice polygon, defined in the shared runtime rather
than a course manifest. Its seven everyday topics, geometry, evidence rules and
formulas are identical; labels use the learner's interface language. Course
catalogs supply exercise meanings and course-local journals supply evidence.
There is no per-course Stats capability, axis pack or provider. Goal changes
affect future selection, never the shape or recorded evidence.

[practice-compass.mjs](../apps/language-runtime/static/source/practice-compass.mjs)
resolves only encountered game/bank/item identities to authored English meanings
and uses the shared English embedding engine. For item vector `v` and topic
probe `a`, both normalized, the weight is
`k = clamp((cos(v,a) - 0.3) / 0.7, 0, 1)^2`. Each unique identity contributes
at most once. The outer practice radius is `1 - exp(-sum(k) / 2)`; the inner
independent-attempt radius is `1 - exp(-sum(k * independentEvidence) / 2)`.
These are bounded evidence masses, not mastery or completion percentages.
Independent errors count; help and legacy exposure alone do not establish an
independent attempt. Repetition cannot keep enlarging one identity's contribution.

Mapping reads progress without changing it. It embeds at most 96 new texts per
request in batches of at most 24, reuses bounded caches, supports cancellation,
and exposes remaining work for refresh. Missing catalogs, English text, history
or vectors remain explicitly unmapped. Empty and unavailable states preserve
the seven-topic frame. A partial map says how much evidence could be mapped.
The old semantic ledger remains readable for persistence compatibility; its
historical mastery projection does not feed this Stats view.

Mapping does not guarantee topic coverage: a valid exercise can fall below the
similarity floor for every topic and remain unplaced. The shared threshold is
a heuristic. Controlled-vector tests establish the arithmetic and evidence
boundaries, not real-model semantic coverage; the browser check also shows
partial maps for existing practice. Exact practice counts remain available
regardless of topic placement.

The optional Practice details disclosure reads
`CaatuuLearning.practiceSummary({ now })` without model inference and provides
exact counts alongside the polygon.

Each game/bank/item identity is counted once. Separate exercises and answer
directions stay separate; there is no curriculum denominator or completion
percentage. Stacked bars group the retained evidence into independent attempts,
help recorded, and other practice. An independent error counts as an attempt,
not knowledge. Independent evidence takes precedence over help in this display;
legacy records cannot establish support provenance. The compact history cannot
reconstruct every historical unaided failure after later ambiguous events, so
these are counts supported by retained records, not a new event ledger.

The bar width is `100 × category count / largest game item count`. Colors also
have text labels and exact counts. Totals show encountered identities, identities
with independent evidence, and identities whose explicit modern due time is at
or before `now`. Due items are a review schedule, not an estimate of forgetting.
Activity totals use this course's history, while the header wallet remains a
journey total. Empty, legacy, partial-read and unavailable states are explicit;
an unavailable history does not appear as zero and the goal stays usable.

No probability, accuracy or mastery estimate is derived from activity totals.
The same shared semantic provider and projection assets ship in every course's
offline catalog and in the common Android runtime package.

Focused checks live in `course-practice-summary.test.mjs`,
`course-stats-ui.test.mjs`, `learning-goals.test.mjs` and
`skill-compass-language-boundary.test.mjs` and `practice-compass.test.mjs` under
the shared runtime tests. These cover all five real course catalogs, shared
geometry, assisted and independent errors, identity isolation, bounded mapping,
unknown evidence and goals remaining separate.

## Policy interfaces

The pure policy API returns both selection and explanation:

```js
const { items: selected, trace } = createAdaptiveDecision(items, {
  identity: { courseId, gameId, bankId, assessmentDirection }, history,
  goal, learner, semantic, difficulty, minimumPool, limit, now, random,
  config: { exploration: 0.15, temperature: 0.7, targetResponseProbability: 0.75 }
});
```

`accessDiagnostics: true` adds per-slot hard and available sets, overlapping
restriction predicates, ordered support stages and restored IDs. Detailed arrays
are absent by default. `createSamplingExperiment` is an explicit manual-only
Evaluator B entry point for controlled access/scoring ablations; normal gameplay
configuration cannot enable those controls. See the
[candidate-access investigation](ADAPTIVE_POLICY_INVESTIGATION.md).

`config.weights` overrides named feature weights from the module. Goals can supply
explicit category IDs or per-item weights. `learner.knowledgeByItem` accepts
optional `recallProbability`/`responseProbability`; production does not invent them.
`learner.evidenceByItem` can separate actual assessed bank evidence from aggregate
scheduling history: conjugation forms affect board readiness and review demand,
but their outcomes are not relabelled as parent-verb assessments.
`semantic.byItem` accepts optional goal/recent cosine similarity. `getId` and
`getGroupKey` preserve game identities and answer-equivalence constraints.

[adaptive-practice.mjs](../apps/language-runtime/static/source/games/adaptive-practice.mjs)
exports the game-facing `selectContentItems(items, {policy, ...options})` adapter.
Pass `policy: CaatuuLearning.samplingContext(...)`; `policy.config` configures it,
and `policy.select(items, options)` replaces the pure decision implementation.
It must return `{items, trace}` using original eligible items without duplicate IDs
or answer groups.
No policy identity, or `policy.id === 'existing'`, preserves the legacy selector.
`policy.onDecision(trace)` and `options.onDecision(trace)` inspect decisions;
`CaatuuSamplingDiagnostics.latest()` exposes the last local runtime decision.
Traces contain feature availability, contributions, constraints, fallback reasons
and conditional draw distributions. They are not total batch inclusion probabilities
and are not stored or transmitted as telemetry.

## Optional semantics and bounds

[learning-semantics.mjs](../apps/language-runtime/static/source/learning-semantics.mjs)
shares image search's serialized English MiniLM engine and 256-text LRU cache.
`features()` reads cached vectors for every supplied eligible candidate, without
inference. After selection, `warm()` scans at most 128 candidates and embeds at
most 16 new candidate texts plus one goal and up to eight recent references.
The runtime prioritizes selected/recent items and rotates the remaining warmup
cohort. It retains at most 24 bank providers; queues/cache work are bounded.
Timeouts and retry backoff expose unavailable semantics while ordinary selection
continues. Missing or invalid English inputs receive no semantic feature.

The pinned model uses 384-dimensional, mean-pooled, normalized English embeddings.
Equal English text may share a vector, never assessment evidence. English proximity
cannot establish target grammar, pronunciation, difficulty, retention or transfer.
Evaluator C's verified on-disk cache is separate from the browser's memory cache;
neither requires another evaluator or a new external service.

## Exactly three independent manual evaluators

Run in the existing `caatuu-dev` container whose `/workspace` bind is the canonical
`C:\Work\caatuu` checkout on `main`. No evaluator requires another to run or pass.
These three commands produce readable Markdown and machine-readable JSON:

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --out with-production
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs
```

| Evaluator | Question, configuration and outputs |
| --- | --- |
| [A: learner state](../tools/learning-evaluation/stats/README.md) | Scripted hidden synthetic knowledge feeds the real stats reducer, without adaptive sampling. `stats/fixture.json` is the small example; `stats/config.json` controls seed, learners, rounds and forgetting. `--semantic` checks the shared practice polygon for every course using fixed vectors, not MiniLM. Reports: `artifacts/learning-evaluation/stats/<name>/{report.md,results.json}`; use `--name` to preserve separate runs. |
| [B: sampling policy](../tools/learning-evaluation/policy/README.md) | Independent learning/response/forgetting simulator; original perfect-state comparison plus explicit staged access studies with perfect or real production-observable evidence and fixed/spacing/low-benefit hypotheses. `policy/config.json`, `fixture.json` and `policy/studies/` control profiles, goals, seeds, budgets and delay. Reports: `artifacts/learning-evaluation/policy/<out>/{report.md,results.json}`; repeated output names overwrite. |
| [C: course content](../tools/learning-evaluation/content/README.md) | Full metadata inventory, separately counting authored records and playable units; default semantic inspection samples up to 384 unique English documents reproducibly. `content/config.json` controls seed, courses and diagnostics. Reports: `artifacts/learning-evaluation/content/<run>/{corpus.json,results.json,report.md}`; new directories preserve earlier reports. `--fixture` is the small example; `--no-semantic` skips model access. |

Each entry point accepts `--config`; its README documents size/seed overrides.
B's small run can add `--interactions 12 --seeds 17 --profiles novice --goals daily-life`.
Generated reports/caches remain ignored. Source hashes identify uncommitted inputs;
B also hashes the bridge's declared `policyMetadata.sourceFiles`. Keep that list
complete when adding imports. C verifies model/tokenizer/runtime signatures before
reusing embeddings; size, seed, input normalization and backend affect comparisons.

## Interpretation and comparison

A reports evidence fidelity, unsupported confidence and response to evidence;
calibration/error of unavailable probabilities is explicitly unassessed. B reports
full-bank learning gain, delayed recall, goal progress, challenge suitability,
repetition, novelty and weak-area attention. Its learning reward is independent of
policy scores. The fixture run does not exercise browser semantic warmup or certify
real course learning. It defines no optimal teaching sequence or oracle regret.

The initial integrated B run (three profiles, two goals, five seeds, 120 interactions,
seven-day delay) found mean delayed full-bank recall of 0.2965 for adaptive practice,
0.2971 for legacy and 0.4408 for uniform. Both paced selectors covered about 56% of
the eligible fixture bank versus 100% for uniform. Retained pacing is part of the
policy comparison; these findings justify investigation, not a human superiority
claim, retrospective reward change or pedagogical release gate.

C reports distributions, duplicates, within-sample neighbors, concentration and
potential grade gaps, never an aggregate course-quality score. Sparse regions are
relative to inspected content; absent topics require an explicitly supplied reference.
Compare like configurations, corpus/model hashes, seeds and sampling sizes; inspect
per-profile and paired differences rather than one aggregate number. Ordinary tests
protect implementation correctness. None of these exploratory metrics run in default
tests, releases, schedules, background monitoring or a dashboard service.
