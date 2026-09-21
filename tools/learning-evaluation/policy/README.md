# Sampling-policy evaluator B

An independent, manually invoked synthetic experiment. It imports the actual
[existing selector](../../../apps/language-runtime/static/source/games/content-progression.mjs)
but does not run evaluators A or C, a server, model downloads or extra packages.
The default experiment uses perfect synthetic probabilities. The optional
observable-real study path invokes the actual production reducer and state
adapter through an isolated in-memory browser harness; it supplies no latent
probabilities. Results describe this
simulator; they do not establish gains for people or an optimal teaching sequence.
There is no regret metric or optimal reference.

## Run in the established container

From canonical `C:\Work\caatuu` on `main`, inspect the existing container first:

```powershell
docker inspect caatuu-dev --format '{{.State.Status}} {{json .Mounts}}'
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/policy/policy.test.mjs tools/learning-evaluation/policy/investigation.test.mjs
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs
```

The mount must be this checkout at `/workspace`. Stop if the container is
unavailable or mismatched. These commands do not create or change containers.
Node built-ins are sufficient. The CLI checks canonical container paths,
main-only refs and ignored artifact output before writing.

Default size: 3 policies × 3 profiles × 2 goals × 5 seeds = 90 runs,
120 interactions each. A small smoke run and a changed budget are explicit:

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --interactions 12 --seeds 17 --profiles novice --goals daily-life --out smoke
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --interactions 360 --seeds 17,29,43,71,103 --out longer
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --help
```

`--config` and `--fixture` accept JSON paths; `--profiles`, `--goals`,
`--delay-days`, `--seeds` and `--interactions` override resolved settings.
The configured `startTime` must include an explicit ISO timezone (`Z` or offset).
`--out NAME` writes only
`artifacts/learning-evaluation/policy/NAME/results.json` and `report.md`.
The default NAME is `default`; repeating a name replaces those generated files.
Use distinct names to retain earlier experiments. The root ignore rule already
covers artifacts; no generated reports or caches belong in source control.

The default [config](config.json) and small [fixture](fixture.json) are complete,
independent inputs. JSON results embed both, per-step outcomes, each run's own
history, initial/final/delayed knowledge, final latent state, all metric
distributions, paired differences, Git HEAD, Node version and source hashes.
Uncommitted source is hashed, so a commit hash alone is not the experiment state.
CLI arguments are recorded; changes to hashed inputs during a run abort output.
Production adapter dependencies declared by `policyMetadata.sourceFiles` are
hashed before the run and checked again afterward. Keep that list complete when
adding imports; the runner does not discover arbitrary transitive dependencies.

## Public interfaces and ownership

All evaluator B code is owned under this directory. Nothing here changes game
hosts, production policy, goal persistence, stats estimation or other evaluators.

| Module | Export | Contract |
| --- | --- | --- |
| [runner.mjs](runner.mjs) | `runEvaluation({config, fixture, policies?})` | Async independent paired experiment; defaults to three baselines. |
| [runner.mjs](runner.mjs) | `simulateRun({config, fixture, profile, goal, seed, policy})` | Async one-run engine returning trace, metrics, history and latent snapshots. Profile/goal are fixture objects. |
| [runner.mjs](runner.mjs) | `validateInputs(config, fixture)`, `eligibleCandidates(fixture, config)` | Shared hard eligibility; simulation parameters are excluded from policy candidates. |
| [policies.mjs](policies.mjs) | `baselinePolicies()`, `loadProductionPolicy(path)` | Per-run adapter factories; the latter imports the integration-owned bridge. |
| [environment.mjs](environment.mjs) | `createEnvironment({fixture, profile, seed, now, transfer, model?})`, `SIMULATOR_ASSUMPTIONS`, `SIMULATOR_MODELS` | Independent environment methods and serialized formula/constants metadata; default model remains fixed. |
| [evidence.mjs](evidence.mjs) | `recordOutcome(history, itemId, outcome, now)` | Ordered unique encounter projection for scheduler input; mutates only the supplied history. |
| [random.mjs](random.mjs) | `seededRandom(seed)`, `keyedRandom(seed, ...keys)` | Local reproducible streams and stateless environment draws. |
| [report.mjs](report.mjs) | `renderMarkdown(result)`, `metricDescriptions` | Markdown report and metric definitions. |
| [observable.mjs](observable.mjs) | `createObservableEvidence(...)` | Real reducer/adapter path using only observed encounter fields; reuses A's harness utility without executing A. |
| [study.mjs](study.mjs) | `runStudy`, `freezeStudy`, `applyFreeze`, `pairedStudyComparisons` | Opt-in access investigation, pre-outcome freeze and seed-level paired summaries. |

A policy is `{id, label, create()}`; `create()` returns a fresh object with
`select(input)`. Both factory and selection may be async. Selection returns one
eligible item ID (or `{itemId, trace}`); an optional `lastDecision()` supplies the
same trace after selection. It receives this immutable snapshot:

```js
{
  identity: { courseId, gameId, bankId },
  candidates: [{ id, difficulty, usefulness, complexity, validTask }],
  learner: {
    mode: 'perfect-synthetic',
    evidenceByItem: { /* current run's full bank encounter history */ },
    knowledgeByItem: {
      /* item ID: { recallProbability, responseProbability } */
    }
  },
  goal: { id, label, weights: { /* item ID: objective weight */ } },
  now, random, difficulty, minimumPool
}
```

Every item identity is scoped by course/game/bank. The fixture is one synthetic
bank with distinct exercise identities; it does not merge real listening,
recognition or production histories. Optional knowledge is perfect current
latent retrieval and independent response probability. It contains no learning
rates, half-lives, transfer graph or future outcomes. Activity and readiness are
not knowledge. The baselines ignore the optional knowledge.

The maintained [production bridge](../production-policy.mjs) delegates directly
to `createAdaptiveDecision()` with supplied optional knowledge, goal weights and
each run's evidence history. It does not invoke production estimation or browser
semantic warmup. It exports `createPolicy()` and `policyMetadata` containing the
label, implementation identifier and `sourceFiles` dependency paths. The CLI
includes those files in source hashes and rejects detected changes during a run.
Without `--production-adapter`, only the three baselines execute and production
is explicitly marked pending; passing the bridge adds the actual fourth policy
to this same evaluator, not a fourth evaluator.

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --out with-production
```

## Fair comparison

Uniform samples the full hard-eligible bank. Usefulness weighting assigns each
eligible item probability `usefulness / sum(usefulness)`. The existing scheduler
adapter calls actual `selectContentItems(candidates, {history, difficulty,
minimumPool, limit: 1, random, now})` on that same full bank. Its challenge
frontier, introduction budget and shortlist are internal policy behavior; they
never prefilter other baselines. Difficulty ceiling and explicit task validity
are the only eligibility rules. The minimum pool defaults to one because this is
a single-item encounter loop; it can be changed for sensitivity analysis. It is
not a simulation of a full Word World queue (whose pool is four) or a game board.

All runs begin with empty evidence and identical profile/item initial recall for
each profile/goal/seed tuple. A returning learner has a higher authored initial
recall but no imported app history. All policies have the same interaction
budget and timestamps. Each creates its own environment, policy instance and
history. No history or realized outcome is reused from another policy.

Policy streams are seeded by seed/profile/goal separately from environment
draws. Environment draws are keyed by seed/profile/step/channel, omitting action
and policy: equal exogenous uniforms are paired even when actions diverge, then
transformed by each selected item's current probability. Extra policy RNG calls
cannot shift response draws. Seed variation changes responses, not initial
recall. Initial-state uncertainty is represented only by the authored profiles.

## Independent learner assumptions

Each item's `simulation` fields are independently authored initial recall `p0`,
learning rate `a`, half-life `h` and guessing probability `g`. There is no formula
mapping usefulness, complexity, scheduler readiness or policy score to them.
Profiles independently vary initial recall, learning, forgetting, slips, hints
and exposure-only frequency. The fixture deliberately mixes easy/hard latent
items within editorial levels.

Initial probability is `clamp(p0 + profile.initialRecallOffset, 0, 1)`. Between
interactions, recall follows `p(t) = storedRecall * 2^(-elapsedDays / H)` where
`H = h / profile.forgettingMultiplier`. Half-lives remain fixed; neither evidence
counts nor repeated success makes a permanent mastered state.

A modality draw first selects exposure, assisted practice or independent
response. On assessed turns, retrieval succeeds with probability `p`. Retrieved
answers slip with the profile slip probability `s`; failed retrieval can guess
correctly with probability `g`. A slipped retrieval does not subsequently guess.
Thus independent observed correctness has probability `p*(1-s) + (1-p)*g`.
An assisted failed response is rescued with probability 0.6. Exposure has
`correct: null`. Lucky guesses are observed independent successes when no aid
was used, but are still distinct from latent retrieval in the trace.

Practice adds `directGain = (1-p) * clamp(a * profile.learningMultiplier * f, 0, 1)`.
Fixed learning factors `f` are exposure 0.35, assisted 0.65, independently
retrieved 1, and failed retrieval with feedback 0.75. Retrieval followed by a
slip still uses the retrieval learning factor. These constants are assumptions,
not research estimates. There is no extra spacing multiplier, learned stability,
fatigue, response latency, motivation or dropout model.

Transfer proposals are `directGain * transfer.rate * edge.weight` along explicit
directed links only. Each proposal is capped by remaining recall headroom and
remaining lifetime incoming `transfer.totalCap`; all outgoing proposals share
the `transfer.maxPerStep` budget proportionally. Default caps are 0.025 total per
interaction and 0.12 cumulative per destination. Caps count lifetime additions,
even if those additions later decay. There are no same-step cascades or inferred
embedding neighbors. Transfer does not add encounters, independent evidence or
mastery claims. The bank is within one course; no cross-course transfer exists.

Default evidence is a narrow synthetic projection into the current scheduler's inputs:
exposure, assistance, mistakes, independent success, elapsed practice days,
spaced success, interval and due time. First independent success schedules a
day; qualifying spaced success grows the interval by 1.8 up to 30 days. Both
elapsed interval since the success anchor and since latest practice are required.
Assistance/errors shorten review to ten minutes. A single ordered encounter is
recorded per interaction. Duplicate callbacks, correction journals, reset races,
storage durability and mixed assessment banks are not modeled or reimplemented.
See the production [progression contract](../../../docs/CONTENT_PROGRESSION.md).

## Metrics and interpretation

All scores use the entire hard-eligible bank, including unpracticed items. Read-only
probes compute exact expected latent recall immediately before training, after
the last interaction, and after the configured no-practice delay. They consume
no response RNG, produce no encounters and cause no testing effect. A matched
no-practice environment supplies a forgetting control, not a teaching optimum.

- **Learning gain:** final minus initial mean recall. **Gain over no practice:**
  final minus control at that same time.
- **Delayed retention:** delayed mean recall. **Retained gain:** delayed recall
  minus control at that same delayed time. **Retention decay:** immediate minus
  delayed recall. These are raw probabilities/differences, not percentages of
  items mastered or ratios of retained learning.
- **Goal progress:** final minus initial recall weighted by independently
  authored positive goal weights, normalized over eligible items. Goal weights
  are neither usefulness nor a universal semantic compass. Delayed goal recall
  and its gain over no practice are also reported.
- **Challenge suitability:** share whose pre-practice latent recall lies inside
  the configured diagnostic interval, plus mean selected recall. This interval
  is an adjustable analysis assumption, never a validated teaching threshold.
- **Repetition:** one minus distinct practiced items / interactions.
  **Recent repetition:** share selected within the preceding configured window.
  **Novelty coverage:** distinct practiced / eligible items.
- **Relevant weak attention:** share selecting positive-goal-weight items below
  the configured recall cutoff, conditional on at least one such item existing.
  Mean relevant-weak availability on the same turns is the uniform reference
  share. Both are null if there are no opportunities.
- **Independent accuracy:** observed correct / independently assessed responses,
  including guesses/slips. Null if no independent assessment occurred.

Markdown reports definitions, assumptions, policy status, aggregate distributions,
profile/goal distributions across seeds, and paired differences from uniform.
JSON includes all per-run metrics and all profile/goal distributions. Sample SD,
minimum, maximum and non-null n describe variation, not confidence intervals.
Aggregate SD mixes profile/goal differences with seed variation. No ranking is
asserted by correctness tests, and results must not be generalized to people.

## Integration handoff

The production adapter is available and its integrated comparison has been run.
The initial 120-run comparison found lower delayed full-bank recall for adaptive
and legacy pacing than uniform sampling under this simulator's assumptions; see
the [runtime/evaluation overview](../../../docs/ADAPTIVE_LEARNING.md) for scope and
interpretation. The original perfect-state path needs no production stats adapter;
the optional observable path uses the real reducer and adapter directly, never
evaluator A output. No central test registration is
required to invoke the focused `node --test` command above. Any optional central
registration of software-correctness tests belongs to the integration owner.
Do not register exploratory runs, numeric learning targets or pedagogical
thresholds in default tests, CI, release gates, schedules, telemetry or services.

## Manual candidate-access investigation

This remains evaluator B, selected by `--study` on the same entrypoint. The
original config, fixture and fixed model remain unchanged. The maintained
production bridge now shares gameplay's four-most-recent-identity input; the
earlier adaptive trajectories omitted that input. Historical adaptive results
require their recorded source versions for exact reproduction. Preserve those
artifacts and use fresh output folders with the current bridge.
`--assert-baseline PATH` requires exact equality of the resolved configuration
and every complete run against a saved result, including trajectories and metrics.
The [study record](STUDY_RECORD.md) records the reviewed shortlist and artifact paths.

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --assert-baseline artifacts/learning-evaluation/policy/investigation-baseline/results.json --out investigation-reproduction-final
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/screen.json --out investigation-screen
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/heldout-plan.json --freeze-from artifacts/learning-evaluation/policy/investigation-screen/results.json --variants adaptive-paced,uniform-hard,outside-exploration-.05 --out investigation-freeze
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/heldout-plan.json --freeze artifacts/learning-evaluation/policy/investigation-freeze/results.json --out investigation-heldout
```

The [screen](studies/screen.json) uses eight fixed-score/control variants, two
development seeds and all six profile/goal cells. Uniform-paced and adaptive-paced
share the paced access controls. Uniform-hard and adaptive-hard remove soft
frontier, introduction, slot and recency controls while preserving task validity
and difficulty. Single-control ablations and an outside-exploration probability
of 0.05 expose which restrictions explain access. The bridge calls the real
runtime `createSamplingExperiment`; no selector is copied into B. Experiment
controls are opt-in and do not alter the production default.

The independently authored [held-out fixture](studies/heldout-fixture.json) and
[held-out plan](studies/heldout-plan.json) were written before the screen. After
review, freeze the declared screened variants **before** running held-out results
(the bounded API accepts two through five).
Freeze writes a record and executes zero learning runs. It captures the shortlist,
primary metrics, plan and screen hashes, exact hypothesis constants, and all
declared executable/config/fixture hashes. Execution rejects changed frozen
inputs. Ordinary CLI overrides cannot alter a study. Detailed JSON is written
one run at a time to avoid a single oversized serialization string.

The held-out plan uses three distinct seeds, the same four declared profile/goal
cells in every scenario, 10- and 36-day horizons, and six staged scenarios rather
than a full Cartesian experiment. Three shortlisted policies give 216 runs.
Both horizons retain 12 interactions per day, two minutes apart and a seven-day
no-practice probe. Ten days cannot accumulate more than ten practice days;
increasing within-day repetitions cannot manufacture elapsed spacing. The longer
horizon tests whether the observed frontier remains unchanged while harder items
are hard-eligible. This is a diagnostic flag, not proof of an impossible transition.

`perfect` supplies synthetic evidence plus exact current retrieval/response
probabilities. `observable-real` supplies real reducer history and the public
learner-state adapter output, with no `knowledgeByItem`. Only observed correctness,
evidence modality and encounter identity/time enter the reducer. Recall and
response probabilities remain unavailable. **These modes change both probability
availability and the evidence implementation; their difference cannot isolate
either effect.** The study reports input snapshots, feature availability and real
reducer provenance. Exposure or successful assistance never becomes independent
assessment credit, and unavailable knowledge is not treated as zero mastery.

Simulator hypotheses are fixed before held-out execution:

- `fixed`: the original exponential forgetting and bounded learning/transfer model.
- `spacing`: a genuinely retrieved independent response without a slip, after at
  least 0.5 days since prior practice, multiplies half-life by
  `1 + 0.4 * min(1, gapDays / 2) * (1 - 0.5 * p)`, capped at four initial half-lives.
  Exposure, assistance and guesses do not qualify. This changes future forgetting,
  not just the immediate learning coefficient.
- `low-benefit`: fixed forgetting, zero transfer, and direct gain multiplied by
  `0.2 / (1 + 0.5 * priorPractices)`. This deliberately disfavors reinforcement.

These transparent, authored hypotheses are not fitted learning models or empirical
claims. No runtime frontier/readiness score determines latent learning ability.

Access diagnostics distinguish hard-eligible universe `H`, group-valid remaining
items and actual positive-probability support `A`. They retain overlapping
restriction labels, stage sets, pool/category fallbacks, chosen-item conditional
probabilities, normalized feature values/sources, admission counts and item order.
Restriction counts must not be added as disjoint causes. Never hard-eligible,
hard-eligible never admitted, admitted never selected and selected without an
independent assessment are separate categories. Per-item rows carry editorial
difficulty/complexity, category and bank position for inspecting bias.
For outside exploration, consult restored IDs and actual support together with
the ordinary restriction predicates. A computed frontier may still be reported
when its experimental control is disabled; its duration then does not imply an
active restriction.

Coverage denominators are authored playable assessment IDs, not course prose or
shared translations. One interaction chooses one assessment ID. Exposure-only
events assess zero items; assisted and independent events assess one. Reports
include modality shares, independent coverage, unassessed-item attention, due
backlog, frontier duration, practice/independent days and spaced successes. A due
backlog requires an explicit due timestamp, not a missing/null field. No time-cost
model is introduced.

Primary outcomes remain delayed whole-bank and goal-weighted recall. Within each
scenario, compare identical profile/goal/seed pairs first, average profile/goal
cells within a seed, then summarize those two or three seed means. The saved
cell-level differences and subgroup summaries expose opposing effects. Descriptive
pooled means are not independent replication; seed SD/ranges are not confidence
intervals or evidence of human learning. A broad-coverage gain in these synthetic
banks is insufficient by itself to change production pacing.

## Gameplay recent-history alignment and five-policy comparison

The [follow-up design](../../../docs/ADAPTIVE_POLICY_RUNTIME_ALIGNMENT.md) fixes
the missing recent-history input, then compares five predeclared variants with
fresh seeds. The historical comparison fixture has already been studied; this
is fresh-seed confirmation, not unseen-content validation. All five arms are
declared before outcomes, and all five are frozen without selection or tuning.
The screen has 60 runs; confirmation has 360 runs across four short/long scenarios.
Production defaults do not enable either new experimental control.

```powershell
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/policy/runtime-inputs.test.mjs tools/learning-evaluation/policy/policy.test.mjs tools/learning-evaluation/policy/investigation.test.mjs apps/language-runtime/tests/adaptive-sampling.test.mjs apps/language-runtime/tests/adaptive-access.test.mjs apps/language-runtime/tests/adaptive-experiment-controls.test.mjs apps/language-runtime/tests/adaptive-game-integration.test.mjs

docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/runtime-aligned-screen.json --out runtime-aligned-20260921-screen

docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/runtime-aligned-heldout-plan.json --freeze-from artifacts/learning-evaluation/policy/runtime-aligned-20260921-screen/results.json --variants adaptive-paced,uniform-hard,outside-exploration-.05,soft-frontier,cross-category-recency --out runtime-aligned-20260921-freeze

docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/runtime-aligned-heldout-plan.json --freeze artifacts/learning-evaluation/policy/runtime-aligned-20260921-freeze/results.json --out runtime-aligned-20260921-confirmation
```

Choose new output names for later reruns. The shared recent-history helper is
included in both the production dependency list and study source hashes. Freeze
also rejects changed shared executable/configuration/fixture hashes since the
screen. A comparison matches the selector input for this single-item case, not
all game-specific exclusions, board sizes, grouped evidence or semantic features.
