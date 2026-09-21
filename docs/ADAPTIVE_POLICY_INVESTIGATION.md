# Candidate access and simulator investigation

The [21 September follow-up](ADAPTIVE_POLICY_RUNTIME_ALIGNMENT.md) corrects
the evaluator's recent-history input and reports five new policy comparisons.
The frozen investigation below is a historical record under its original inputs.

This investigation continues the [adaptive-learning implementation](ADAPTIVE_LEARNING.md).
It asks why the paced selectors performed worse than broad sampling in the
original synthetic comparison. It does not require the adaptive policy to win.
Exactly three manual evaluators remain; the experiments extend
[Evaluator B](../tools/learning-evaluation/policy/README.md). A and C need not run first.

**Decision: retain production pacing and score defaults.** The controlled screen
supports restricted candidate access as the leading cause of the original short-run
gap. The 216 frozen held-out runs show that the proposed 5% route helps early
coverage, but its long-horizon benefit is small or assumption-dependent, with
opposing subgroup effects. No permanent metadata dead zone was demonstrated.
Keep the opt-in diagnostics and manual experiments; do not enable the experimental
route in gameplay. This is a decision under limited evidence, not proof that the
existing policy is educationally optimal.

## Reproduction and study design

The original four-policy comparison was reproduced before changing the evaluator.
All 120 run records and the resolved configuration exactly match `integrated-final`.
The preserved output is `artifacts/learning-evaluation/policy/investigation-baseline/`.
Its source hashes identify the uncommitted implementation, alongside Git state;
the commit alone does not identify this shared dirty checkout.

| Policy | Delayed whole-bank recall | Exposure coverage |
| --- | ---: | ---: |
| Uniform | 0.4408 | 1.0000 |
| Usefulness | 0.4342 | 1.0000 |
| Legacy scheduler | 0.2971 | 0.5611 |
| Adaptive | 0.2965 | 0.5611 |

The baseline has 12 hard-eligible assessment items, three learner profiles, two
goals, seeds 17/29/43/71/103, 120 interactions at 12 per day, two minutes apart,
starting 2026-01-05 09:00 UTC. This is ten practice days, not 120 independent
practice days. Every policy receives the same starting conditions, item validity
and difficulty ceiling, interaction opportunities and modality draws. A response
assesses one item; exposure assesses none. The probe is seven days after the
final scheduled interaction for every policy. There is no authored time-cost model.

The development screen holds score weights and normalization fixed: uniform or
adaptive scores crossed with paced or hard-only access, followed by individual
frontier, introduction-budget and slot-allocation removals, and a 5% outside
exploration route. Each run develops its own history. Two development seeds and
the original six profile/goal cells make 96 runs. No feature-weight search is used.

A coordinator-selected shortlist is frozen with executable, configuration and
fixture hashes before held-out execution. The independently authored held-out
fixture changes items, grade spacing, learning parameters and transfer edges;
its seeds are 211/307/401. Four declared profile/goal cells cover every profile
and both goals without a full Cartesian sweep. The short horizon remains ten
days; the longer horizon has 432 interactions over 36 days. Perfect-state and
real observable-state inputs are compared under fixed forgetting, with additional
spacing and low-benefit hypotheses in the observable long-horizon scenarios.
This is a sensitivity study of selected conditions, not an exhaustive validation.

Delayed whole-bank recall remains primary; delayed goal-weighted recall is also
declared before outcomes. Learning gain, coverage, independent assessment,
repetition, backlog, weak/unassessed attention, access, stalls, feature availability
and modalities are diagnostics. Paired differences are computed within identical
scenario/profile/goal/seed cells, then averaged within seed before reporting seed
variation. Two or three seeds support descriptive ranges, not precise population
confidence intervals. Full trajectories retain subgroup and seed results.

## Controlled development-screen findings

| Scoring/access | Delayed whole-bank | Delayed goal | Mean available items | Exposure coverage |
| --- | ---: | ---: | ---: | ---: |
| Uniform, paced | 0.2926 | 0.3173 | 1.76 | 0.5486 |
| Adaptive, paced | 0.2977 | 0.3279 | 1.80 | 0.5694 |
| Uniform, hard-only | 0.4398 | 0.4341 | 12.00 | 1.0000 |
| Adaptive, hard-only | 0.4169 | 0.4884 | 12.00 | 0.9861 |
| Adaptive, frontier removed | 0.4290 | 0.4859 | 6.83 | 1.0000 |
| Adaptive, introduction budget removed | 0.2977 | 0.3279 | 1.80 | 0.5694 |
| Adaptive, slot allocation removed | 0.2905 | 0.3300 | 3.87 | 0.5139 |
| Adaptive, 5% outside exploration | 0.3876 | 0.4293 | 12.00 | 0.9306 |

Controlled access changes are much larger than scoring changes in this original
short fixed-half-life fixture. Holding uniform scoring fixed, paced access costs
0.1472 delayed recall; holding adaptive scores fixed, it costs 0.1193. Removing
only the frontier adds 0.1314, while removing only the introduction budget changes
no outcome in this screen. Slot allocation removal alone slightly lowers recall.
This supports a frontier/access explanation here; it does not assign every policy
difference to pacing or establish a universal benefit from wider access.

Scoring has a visible tradeoff once access is shared: adaptive hard-only loses
0.0228 whole-bank recall to uniform but gains 0.0543 goal-weighted recall. Within
paced access its mean advantage is only 0.0051, with both supported-profile goal
cells slightly negative. The original adaptive-minus-legacy difference is also
too small and mixed to support a general ranking: subgroup means range from
-0.0078 to +0.0075 and within-seed aggregate differences from -0.0046 to +0.0036.

For current adaptive pacing, five or six of twelve eligible items are never
admitted in each development run. Mean available support is 1.80 despite `|H|=12`.
The frontier is unchanged for stretches of about five days. Maximum independent
days are only one or two and spaced successes zero or one, even though maximum
participation reaches nine or ten days. Frequent two-minute practice and resetting
review intervals therefore matter to the readiness opportunity. The conditional
next-band checks below distinguish this slow progression from a metadata dead zone.

The outside route gives every eligible item positive support, but a small draw
probability does not guarantee selection: coverage is 0.9306, independent coverage
0.9097. Its mean delayed recall improvement is 0.0900 over current pacing, with
seed means 0.0657 and 0.1142. This is enough to investigate, not to deploy.
The frozen shortlist is current adaptive pacing, uniform hard-only access and
the 5% outside route. Complete frontier removal is retained as an explanatory
screen ablation, not a proposed production change.

Modality draws match exactly within paired runs. In the screen, exposure/assisted/
independent shares are 9.17%/12.50%/78.33% for novice, 3.75%/5.83%/90.42% for
returning and 17.92%/34.58%/47.50% for supported. A response still addresses one
unit. These profile differences are intentional, not policy-specific extra
assessment opportunities. They are not measured human study costs.

## Frozen held-out findings and decision

The freeze was written at 2026-09-20 10:41:22 UTC, before held-out execution.
Its plan SHA-256 is
`eccb04b40750ded94db0db9631d960470bd6bc2a674fe0fba57d6a43a2d099b6`.
All 216 runs completed under the unchanged frozen source. A final audit checked
all 72 paired cells for identical initial knowledge, hard eligibility, timestamps
and modality sequences. All 144 observable-state runs retained unavailable recall
and response features in their saved policy snapshots.

| Horizon/model/input | Current pacing: delayed recall | Uniform hard-only | 5% outside route | Route minus current: mean [seed-mean range] |
| --- | ---: | ---: | ---: | --- |
| 10 days, fixed, perfect | 0.2593 | 0.4251 | 0.3506 | +0.0913 [0.0862, 0.0988] |
| 10 days, fixed, observable | 0.2620 | 0.4251 | 0.3456 | +0.0836 [0.0686, 0.0995] |
| 36 days, fixed, perfect | 0.4538 | 0.4761 | 0.4526 | -0.0012 [-0.0027, 0.0017] |
| 36 days, fixed, observable | 0.4490 | 0.4761 | 0.4495 | +0.0005 [-0.0012, 0.0022] |
| 36 days, spacing, observable | 0.6846 | 0.7576 | 0.7048 | +0.0202 [0.0092, 0.0360] |
| 36 days, low-benefit, observable | 0.0589 | 0.0554 | 0.0568 | -0.0022 [-0.0025, -0.0016] |

Perfect-state performance is not consistently higher than observable-state
performance. Uniform's results are identical across these input modes because it
does not use learner features. For adaptive policies the difference combines
probability availability and the real-versus-synthetic history path; it cannot
isolate either contribution. The original unfavorable result is therefore not
explained away by the lack of production recall estimates.

At 36 days every shortlisted policy reaches full exposure and independent
assessment coverage. Current observable pacing reaches up to 27 practice days,
seven independent days and six spaced successes in the fixed model. The early
coverage deficit is a delay under this schedule, not permanent fixture exclusion.
Full coverage still does not imply equal retention: uniform retains a whole-bank
advantage of 0.0272 in the long fixed observable scenario, while current pacing
has a goal-weighted advantage of 0.0206 (0.4965 versus 0.4759).

The 5% route's nearly zero long fixed observable average masks negative novice
subgroups: -0.0060 for daily-life and -0.0099 for work, versus +0.0119 for returning
work and +0.0060 for supported daily-life. Even under the spacing hypothesis,
novice/work averages -0.0033 with mixed seed results. Under low-benefit assumptions
the route loses in every tested profile/goal subgroup. These effects are small
synthetic differences, but they rule out a claim of uniformly better behavior.

The route also changes attention and workload. In the short observable fixed
scenario it lowers recent repetition from 0.8958 to 0.6979, raises unassessed-item
attention from 0.0694 to 0.1306, and raises mean due backlog from 0.6750 to 2.2486
items. Long fixed observable backlog averages 4.7010 for current pacing, 5.4807
for the route and 7.0112 for uniform. Recent repetition is 0.5071, 0.4375 and
0.3580 respectively. Total repetition is 0.9722 for all three long runs because
each visits all 12 items over 432 opportunities; that denominator alone hides
the different repetition timing.

Truth-based weak-area attention is an evaluator diagnostic, never an observable
policy input. In short fixed observable runs it is 0.1833 for current pacing,
0.3410 for the route and 0.6007 for uniform; under the low-benefit hypothesis
current pacing reaches 0.9333 versus uniform's 0.8289. The metric conditions on
opportunities containing a goal-relevant item below the declared recall cutoff.
The full JSON retains coverage, learning gains, backlog, source availability,
conditional draws and paired subgroup results without an aggregate quality score.

There is no justified production correction from this study. A small synthetic
bank, one assessment unit per interaction, no measured study costs and no
challenge-dependent learning mechanism cannot determine the best access tradeoff
for real learners or large game banks. The favorable spacing mechanism did not
make current adaptive pacing beat broad uniform whole-bank recall; the unfavorable
scenario reversed that ranking. Neither result validates the authored mechanism.

The smallest next diagnostic for the state-input ambiguity would keep the real
reducer in both arms and vary only supplied synthetic probabilities, with fresh
declared seeds and no weight search. A decision about human benefit instead needs
a small prospectively specified comparison with durable first-response/support
evidence, matched opportunities and independent delayed probes. More parameter
sweeps of these same hypotheses cannot establish that benefit. Neither follow-up
is started by this investigation.

## What the instrumentation means

`H` contains items valid for the game and selected difficulty. Previously used
answer-equivalence groups leave the remaining hard set on later board slots.
`A` is the actual positive-probability support after soft scheduling restrictions
and any explicit restoration. Traces distinguish frontier, introduction budget,
slot allocation, recency, challenge reservation and minimum-playability fallback.
Restriction predicates overlap: their counts must not be added. Ordered stage
supports and restored IDs show what actually happened.

The report separates never hard-eligible items, eligible but never admitted
items, admitted but never selected items, and selected but never independently
assessed items. Difficulty, category and editorial position remain inspectable.
A frontier that does not move while harder eligible items remain is a stall
indicator, not proof of permanent exclusion: next-band and minimum-playability
exceptions can cross that frontier.

Within a paced slot, the existing distribution is
`P(i|A) = (1-epsilon) exp(score(i)/T) / sum_A exp(score/T) + epsilon/|A|`,
with ordinary `epsilon=0.15`, `T=0.7`. Experimental outside exploration uses
`P(i|H) = (1-eta) P(i|A) + eta/|H_remaining|`, with `eta=0.05`.
These are conditional slot probabilities, not total board-inclusion probabilities.
The experiment-only API cannot be enabled through normal gameplay configuration.
Detailed access arrays are opt-in; optional semantics remain bounded and cached.

## What these simulators can represent

The original model is preserved: recall decays as `p(t)=p0*2^(-delta/H)`, with fixed
item/profile half-life `H`. Practice adds
`(1-p)*clamp(itemLearningRate*learnerMultiplier*modalityFactor,0,1)`.
Factors are 0.35 for exposure, 0.65 for assistance, 1 for successful retrieval,
and 0.75 for feedback. Observed response probability is
`p*(1-slip)+(1-p)*guess`. Explicit bounded, directed, one-hop transfer affects
latent learning only; it never generates assessment evidence.

Spacing in this original model changes when practice occurs but does not improve
memory stability. Editorial difficulty, complexity and challenge suitability do
not change the learning equation; their benefits cannot be established here.
Goal relevance changes selection and evaluation weights. Semantic similarity is
unavailable in the study; only authored transfer edges influence learning.
These limitations make breadth particularly valuable when learning closes the
remaining recall gap and repeated practice has diminishing returns.

The additional spacing hypothesis grows half-life only after genuinely retrieved,
unslipped independent responses with a prior gap of at least half a day:
`H_next=min(4*H_initial,H*(1+0.4*min(1,gapDays/2)*(1-0.5*p)))`.
The low-benefit hypothesis retains fixed forgetting, disables transfer, and
multiplies direct learning by `0.2/(1+0.5*priorPractices)`.
These mechanisms and constants are authored hypotheses, not fitted or empirical
claims. Adding a spacing mechanism does not prove that its effect size is real.

Perfect state supplies synthetic recall/response probabilities explicitly.
Observable mode sends only actual encounter fields through the real stats
journal/reducer and conservative evidence adapter. It does not execute A.
Hidden probabilities, guessed/retrieved labels and learning parameters stay outside
policy input. Recall and response features remain unavailable; challenge uses the
editorial frontier heuristic. Unknown is not weak, missing evidence is not a
posterior uncertainty estimate, and readiness is not mastery. The modes also
differ in their history update path; their comparison is not solely a test of
removing probability features. Perfect input is not a guaranteed upper bound.

## All-course capability and gap check

All five courses share persisted optional goals, conservative item evidence and
adaptive selection. All declare optional embeddings/semantic search; selection
works with semantics disabled. This does not establish equal feature maturity.

| Course | Available adaptive games | Authored topics | Known playable assessment units | Compass maturity |
| --- | --- | ---: | ---: | --- |
| Czech (`cz`) | Verbs, Word World, conjugation, cases, grammar phrases/nouns, listening | 7 | 2,545 | Existing Czech-specific compass |
| Mandarin (`zh`) | Verbs, Word World, character/pinyin Nucleus, listening | 8 | 2,741 | No compass |
| Spanish (`es`) | Verbs, Word World, conjugation, grammar phrases/nouns, listening | 8 | 3,342 | No compass |
| English from Spanish (`es-en`) | Verbs, Word World, conjugation, grammar phrases/nouns, listening | 8 | 3,218 | No compass; learner-base Spanish is not an English embedding authority |
| Norwegian Bokmål (`nb`) | Verbs, Word World, conjugation, grammar phrases/nouns, listening | 8 | 3,998 | No compass |

Counts use C's existing runtime normalization adapters, not authoring rows,
embedding documents, session interactions or answer-equivalence groups. A
conjugation parent selects several assessment forms; Nucleus alternatives can
share an answer reading; listening words/sentences and reconstruction directions
retain their own evidence banks. The one-item synthetic study does not model
these complete multi-answer boards or their human effort.

The retained C inventory has 17,290 authored records, 15,844 playable assessment
units and 9,759 unique canonical English documents. Its semantic inspection sampled
384 documents; it is not full-corpus validation. All authored usefulness/complexity
grades are present and valid. Missing badges or English on structural parent rows
must not be counted as missing playable-task metadata. Runtime fallbacks explicitly
label absent semantic or editorial features instead of inferring mastery.

Correctness checks use real game constructors, all selected difficulty ceilings,
complete conjugation rounds, distinct Nucleus readings, listening choices, separate
evidence directions, goal persistence and semantic-off operation. Separately,
1,720 saved-state metadata probes cross every adjacent occupied band at each
ceiling after either readiness or eight practice days. Maximum checked position
gaps are Czech 92, Mandarin 88, Spanish 90, English 91 and Norwegian 85.
The fresh-day next-band rule bridges every checked gap. This proves conditional
reachability under those states, not that actual learners reach them quickly or
that a short simulated run should cover every item.

## Assessment evidence and provenance gaps

Current public history retains activity, independent successes, spaced successes,
independent days, assisted successes, lapses, due dates and a latest response.
It does not retain a reliable denominator of independent first responses with
durable support provenance. Earlier independent errors may be hidden by later
responses; an unscored hint can overwrite `lastEvidence` without changing the
latest scored result/time. Receipts protect idempotency and conservative credit,
but aggregates do not reconstruct the missing assessment sequence.

No historical assistance, error provenance or denominator is backfilled. Before
future estimation, a minimal versioned event contract should distinguish:

- Identity: course, game, bank, item, assessment direction, content revision/hash
  and stable item identity; explicit assessment-unit ID for multi-answer boards.
- Ordering: event ID, encounter ID, learner/reset generation, timestamp and an
  encounter sequence for equal timestamps or delayed delivery.
- Evidence: presented, support shown, first assessed response and later feedback
  as separate events. The first response records correctness and immutable
  support-before-response status; later help cannot rewrite that provenance.
- Task: response modality and assistance type, with explicit unknown values when
  provenance is missing. Corrections reference the original event and retain
  idempotency. Exposure or board completion cannot create a response denominator.

This is a proposal only. Event storage, migration and a calibrated probability
model are deferred. Exact real-reducer simulation can run without those changes;
the simulator knows newly observed response denominators for reporting, while
the production adapter correctly leaves historical denominators unavailable.

## Exact manual commands and retained outputs

Run from canonical `C:\Work\caatuu` on `main`, with the existing `caatuu-dev`
container mounted there at `/workspace`. No new environment or evaluator is needed.
Report directories are ignored artifacts; retain the original files and use new
output names for independent repeats. The freeze rejects changed executable inputs.

```powershell
docker inspect caatuu-dev --format '{{.State.Status}} {{json .Mounts}}'
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --out investigation-baseline
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --assert-baseline artifacts/learning-evaluation/policy/investigation-baseline/results.json --out investigation-reproduction-final
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/screen.json --out investigation-screen
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/heldout-plan.json --freeze-from artifacts/learning-evaluation/policy/investigation-screen/results.json --variants adaptive-paced,uniform-hard,outside-exploration-.05 --out investigation-freeze
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --study tools/learning-evaluation/policy/studies/heldout-plan.json --freeze artifacts/learning-evaluation/policy/investigation-freeze/results.json --out investigation-heldout
```

Each output name contains `report.md` and `results.json` under
`artifacts/learning-evaluation/policy/`. The original baseline is preserved;
`investigation-reproduction-final` proves the extended evaluator retains its exact
configuration and all 120 complete trajectories. `investigation-screen` holds the
96-run ablation, `investigation-freeze` the pre-outcome record, and
`investigation-heldout` the 216-run comparison. See the
[study record](../tools/learning-evaluation/policy/STUDY_RECORD.md) for the selection
rationale and the evaluator README for metric denominators and CLI contracts.

## Implementation and correctness verification

The runtime change adds opt-in access traces and an explicitly separate manual
ablation API while retaining normal draws, scoring and constraints. B adds real
observable inputs, transparent model hypotheses, staged plans/freezing, detailed
reporting and chunked report serialization. No new evaluator, telemetry,
schedule, storage schema, trained policy, service or release gate is introduced.
Offline cache revisions and setup manifests were refreshed for all five courses.

The focused runtime suites pass 69 tests, including the 1,720 metadata snapshots.
The setup-asset and course-contract suites pass 70 tests. Course compatibility
views match the manifests, repository file policy and Markdown links pass, and
the extended evaluator reproduces all 120 original runs exactly. Evaluator B's
30 ordinary correctness tests cover truth isolation, the actual reducer, model
boundaries, paired denominators, frozen inputs and unchanged baseline behavior;
the exploratory studies remain manual. These checks establish software behavior,
not a pedagogical release threshold.

The canonical checkout remains `C:\Work\caatuu` on `main`, with only local
`main` and remote-tracking `origin/main`. Existing shared work is preserved;
no branch, alternate environment, commit or release was created.

## Follow-on UI objective and deferred work

Move optional goal selection to the existing Stats page within Settings, supported
across courses. Balanced remains the default. Topic goals bias sampling without
bypassing difficulty or filtering out all other topics. Keep the interface simple
and colorful, reusing the existing stats visualization only where its dimensions
have a meaningful course-specific interpretation. A goal arrow or target overlay
must look distinct from observed progress. Difficulty remains separate.

Do not copy Czech linguistic axes into other courses merely for visual parity.
The Stats/goal redesign, universal skills map, broad curriculum expansion,
full-corpus semantic validation, event storage, probabilistic estimation and
unrelated cleanup are outside this investigation. No release is published.

The subsequent cross-course Stats goal implemented the goal relocation and
one shared seven-topic practice polygon described in
[Adaptive practice and manual evaluation](ADAPTIVE_LEARNING.md#shared-course-stats).
The investigation above remains a record of its frozen source and results;
later UI and read-only summary changes do not alter those experiments or imply
that the current working source matches their archived source hashes. The
generalization is now implemented: every course uses the same topic definitions,
evidence formulas and renderer, with no course-specific Stats capability or
provider. This is an observed-practice map, not a linguistic proficiency model.
New event storage and calibrated estimation remain separate future work.
