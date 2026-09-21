# Learner-state / stats evaluator

The optional projection diagnostic can also replay a saved real-browser history:

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic --profiles artifacts/learning-evaluation/content/mapping-baseline-20260921/browser-capture.json --name my-profile-replay
```

The fixture and real-profile results are labelled separately. Real replay uses
the actual shared catalog resolver, bounded mapping facade and signature-checked
embedding cache. It does not invoke or depend on evaluator C. The readable report
summarizes profile accounting; JSON retains histories, each identity's status,
similarities, weights, masses, radii and model/input hashes. See the
[mapping audit](../../../docs/PRACTICE_MAPPING_AUDIT.md) for the captured baseline.

Evaluator A is manually invoked and independent of the policy and content
evaluators. It observes the real `CaatuuLearning.recordExposure()` and
`contentHistory()` implementation through a controlled browser clock and memory
storage. It does not implement a second persistence reducer or select practice
with an adaptive policy. The existing progression module supplies only its
labelled readiness helper.

Run from the canonical checkout using the existing `caatuu-dev` container. Check
that its `/workspace` bind is `C:\Work\caatuu` and it is running first. Do not
create a container, install host dependencies, or start another preview service.

```powershell
docker inspect caatuu-dev --format '{{.State.Status}} {{json .Mounts}}'
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --config tools/learning-evaluation/stats/config.json --seed 260920 --learners 12 --rounds 12
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/learner-state.test.mjs apps/language-runtime/tests/content-exposure-persistence.test.mjs
```

Every run writes `report.md` and `results.json` under ignored
`artifacts/learning-evaluation/stats/<run-name>/`. The default run name includes
a configuration/source fingerprint. Existing run folders are preserved; use
`--name replay-1` (a simple directory name) for a second run. There is no output
option outside this stats directory. JSON retains effective configuration,
source hashes, real history/adapter snapshots, hidden diagnostic truth, metrics
and software checks. No cache or generated report belongs in source control.

Only the last command is a software-correctness test. Evaluator runs, metrics and
pedagogical thresholds are not added to default tests, CI, release gates,
schedules, telemetry or dashboards. Existing runtime `*.test.mjs` discovery
already finds the focused adapter tests; no central test-registration edit is
needed. Production asset registration and integration belong to the integration
owner.

## Adapter contract

The browser-safe [learner-state module](../../../apps/language-runtime/static/source/learner-state.mjs)
exports:

```js
learnerItemState({
  courseId, gameId, bankId, itemId,
  assessmentDirection = null,
  history = {}, // ENTIRE contentHistory(gameId, bankId) result
  now = Date.now() // finite epoch milliseconds; pass explicitly for replay
});
learnerBankState({
  courseId, gameId, bankId, assessmentDirection = null,
  history = {}, itemIds = Object.keys(history), now = Date.now()
}); // array of item states, deduplicated itemIds in supplied order
```

Pass catalog `itemIds` to include unseen items. The adapter performs no storage
access or mutation. It does not accept learner truth, embeddings, guessed
probabilities or profile activity as mastery evidence. Malformed counters,
timestamps and identity inputs throw; omitted legacy counters default to zero.

Public history does not embed its course/game/bank identity. Callers must supply
the identity of the actual profile and bank read. `assessmentDirection` labels
the task represented by that bank; it cannot split a previously mixed bank.
Use separate persisted banks such as `reconstruct-target` and
`reconstruct-source`. No cross-bank, item, direction, course or semantic transfer
is performed.

Every returned field is described here:

| Field | Meaning |
| --- | --- |
| `identity` | Exact supplied `courseId`, `gameId`, `bankId`, `itemId`, `assessmentDirection` (nullable). |
| `evidenceStatus` | Most informative **retained** evidence: `unassessed`, `exposure-only`, `supported`, or `independently-assessed`. This describes provenance, not knowledge level. |
| `activity.exposures`, `successes`, `mistakes`, `practiceDays` | Public history counters preserved as activity. Successes/mistakes may include legacy or supported outcomes; they are not independent trials. |
| `activity.firstSeenAt`, `lastSeenAt`, `lastPracticeDayAt` | Public timestamps, or null when absent. |
| `evidence.independentlyAssessed` | An independent success is retained, or the latest identifiable scored response is explicitly independent (including a failure). False means not provable from this summary, not that none ever occurred. |
| `evidence.independentSuccesses`, `spacedSuccesses`, `independentDays`, `assistedSuccesses`, `lapses` | Preserved public counters. Lapses are mixed mistake activity, not independent failures. |
| `evidence.lastIndependentAt`, `lastAssistedAt` | Preserved public timestamps. `lastIndependentAt` is the last independent **success**, not the last independent attempt. |
| `evidence.latestAssessment` | Null if no scored timestamp exists; otherwise `{at, correct, evidence}`. `correct` preserves the reducer result. `evidence` is null when the public assisted label cannot be attributed to that assessment. |
| `review.dueAt`, `intervalMs` | Existing scheduler deadline and interval, not inferred forgetting or retention parameters. |
| `review.isDue`, `overdueMs` | Null without a deadline; otherwise comparison with `now`, and elapsed overdue time clamped to zero. |
| `review.sinceLastSeenMs`, `sinceLastIndependentMs` | Elapsed milliseconds, null without the corresponding timestamp and clamped to zero under a clock rollback. |
| `uncertainty.kind` | Always `unquantified`. |
| `uncertainty.reasons` | Missing denominator/calibration, task specificity, missing retained evidence, lost error/support provenance, unclassified legacy success, unspecified direction, or history ahead of the clock, as applicable. |
| `uncertainty.independentResponseDenominator` | Always null. Mixed aggregate outcomes cannot provide this denominator. |
| `estimates.recallProbability`, `independentAccuracy`, `knowledgeProbability` | Always null: unsupported interpretations. |
| `readiness` | `{kind:'heuristic', value, source:'contentPracticeReadiness', interpretation:'practice-selection-only', calibrated:false}`. `value` is the existing unit-interval product heuristic; it is not a percentage of mastery. |

For example, an unseen target has the following shape (timestamps and estimates
remain explicitly unavailable):

```json
{
  "identity": {"courseId":"cz","gameId":"word-world","bankId":"reconstruct-target","itemId":"example","assessmentDirection":"reconstruct-target"},
  "evidenceStatus": "unassessed",
  "activity": {"exposures":0,"successes":0,"mistakes":0,"practiceDays":0,"firstSeenAt":null,"lastSeenAt":null,"lastPracticeDayAt":null},
  "evidence": {"independentlyAssessed":false,"independentSuccesses":0,"spacedSuccesses":0,"independentDays":0,"assistedSuccesses":0,"lapses":0,"lastIndependentAt":null,"lastAssistedAt":null,"latestAssessment":null},
  "review": {"dueAt":null,"intervalMs":0,"isDue":null,"overdueMs":null,"sinceLastSeenMs":null,"sinceLastIndependentMs":null},
  "uncertainty": {"kind":"unquantified","reasons":["no-independent-response-denominator","no-calibrated-retention-model","task-specific-evidence-only","no-retained-independent-assessment"],"independentResponseDenominator":null},
  "estimates": {"recallProbability":null,"independentAccuracy":null,"knowledgeProbability":null},
  "readiness": {"kind":"heuristic","value":0,"source":"contentPracticeReadiness","interpretation":"practice-selection-only","calibrated":false}
}
```

## Scenarios and interpretation

[fixture.json](fixture.json) selects two learners and four rounds;
[config.json](config.json) selects twelve learners and twelve rounds. Both pin
the clock, seed, learning gains, spacing, forgetting half-life, guessing/slip
rates and related-transfer fraction. CLI seed/size overrides enable larger
manual runs. The simulator has beginner and uneven priors, repeated successes
and errors, a guaranteed lucky guess, exposure-only and supported practice,
learning followed by a long gap and lapse, a narrowly related exercise, and
opposite assessment directions in separate banks.

Latent strength is held only by the synthetic scenario model and reporting side.
The adapter receives actual persisted history, identity and observation time.
Some outcomes are scripted to guarantee boundary coverage, including early
successes and the post-gap lapse. This is a diagnostic stress test, not an
empirically fitted population or evidence that the chosen learning/forgetting
parameters describe human learners. Only one explicit related pair receives a
small simulator transfer; unattempted related items still receive no adapter
evidence. Authored usefulness/complexity scores are not probabilities and are
not needed by this estimator.

Evidence-status counts and boundary diagnostics assess whether exposure,
support, independence, spacing and direction isolation are represented
truthfully. Before/after states show responses to evidence and elapsed time.
Unsupported-confidence diagnostics count any unavailable estimate incorrectly
returned as a number. Descriptive readiness discrimination compares ordering
against hidden synthetic strength where independent evidence is available; ties
must remain visible. This does not turn readiness into a knowledge estimate.

Recall error, probability calibration, independent-response accuracy and
knowledge-probability error are explicitly unavailable. There is no corresponding
adapter estimate or reliable independent denominator. A long gap can increase
review overdue time while leaving lifetime evidence/readiness unchanged; the
adapter makes no forgetting estimate. Lucky responses can produce legitimate
independent-response evidence without proving latent knowledge.

## Optional shared practice-map diagnostic

`--semantic` invokes the shared practice projection with its common seven topic
axes and controlled 384-dimensional vectors. Every registered course ID receives
the same fixture evidence and must produce the same map values. Course identity
isolates history; courses do not supply Stats dimensions, rules, labels or a Stats
capability. The diagnostic hashes the shared projection and the course catalog;
it does not read a Czech-specific compass configuration.

Checks separate completed exposure, assisted responses and independent assessment,
including independent errors. They cover identity deduplication, bounded repetition
weight, controlled semantic overlap, explicit unmapped items when vectors are absent,
and course/bank/item isolation. Practice and independent rings describe evidence
coverage, not correct-response scores. An independently attempted error can add
independent evidence without claiming success or knowledge. English semantic
relationships route observed evidence onto the common topics; they never grant
assessment evidence to unattempted items or other courses.

These checks run no model, browser provider or IndexedDB persistence. They do not
measure retrieval quality, retention, probability calibration, independent accuracy
or human learning. Axis labels are distinct from embedding coordinate dimensions;
fixture vector geometry is deliberately assigned and does not validate the actual
semantic relationships between the topic names. Missing vectors remain unmapped,
and neither ring is a calibrated knowledge probability or mastery score.

Earlier reports describing a Czech-only semantic reducer, smoothed `mastery`,
assessed-score weights or lifetime score projection are historical observations of
the previous implementation. They remain unchanged. New reports identify the shared
practice-map diagnostic and its source hashes; their evidence metrics are not directly
comparable with the earlier score-based summaries.

## Persistence proposal for the integration owner

No existing persistence files are modified. A future version could retain
explicit first assessed outcome and support provenance per encounter, deduplicate
independent response/error counts with corrections and reloads, and separate
`lastAssessmentEvidence` from subsequent support. Current `lastEvidence` can be
overwritten by an unscored assisted encounter while `lastAttemptAt`/`lastCorrect`
still describe an older response, including callbacks in the same millisecond.
The adapter therefore leaves that assessment's evidence attribution null.

Older independent failures can also become unidentifiable after later support;
`mistakes`, `lapses`, `successes` and XP cannot repair this. Any migration must
preserve unknown provenance, course/game/bank/direction boundaries, encounter
deduplication and reset generations. Even better independent-trial persistence
would not by itself calibrate a recall model. Those changes and any production
integration remain the integration owner's work.

## Importable evaluator utilities

- `harness.mjs`: `await createLearningHarness({courseId, learnerId, now})`
  returns `record(identity, event, at)`, `history(gameId, bankId)`,
  `advanceTo(at)`, `reload()` and `saveStatus()`. `record` and `reload` are async.
  The clock is monotonic; each harness has isolated memory storage and uses the
  real production profile. History is a plain detached copy. No latent state
  belongs in this interface.
- `scenarios.mjs`: `seededRandom(seed)`, `validateConfiguration(config)` and
  `createScriptedLearner(config, learnerIndex)` provide deterministic synthetic
  input. The latter returns hidden truth for the reporting side only.
- `run.mjs`: `await evaluateStats(config, {semantic:false})` returns the JSON
  result without writing files. Only direct CLI execution writes artifacts and
  adds source hashes. Importing it does not run an evaluator. CLI exits nonzero
  for software invariant failures, including requested semantic checks; it has
  no pedagogical metric threshold.
- `semantic-diagnostic.mjs`: `await runSemanticDiagnostic()` returns plain JSON
  with `status`, `checks`, `metrics`, `limitations`, `fixture` and `source`.

These are utilities for manual diagnostics. Another evaluator may import useful
helpers without running Evaluator A or making it a prerequisite.
