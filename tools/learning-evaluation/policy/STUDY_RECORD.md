# Candidate-access study record

The original 120-run adaptive/baseline experiment was reproduced before the
investigation. Its preserved result is
`artifacts/learning-evaluation/policy/investigation-baseline/results.json`.
The extension preserves original configuration, fixture, fixed model and default
trajectories; full-run equality is checked again before shortlist freezing.

The development screen ran 96 simulations from [screen.json](studies/screen.json).
Its report is `artifacts/learning-evaluation/policy/investigation-screen/report.md`.
No score weights were fitted. With the original fixed simulator, no-frontier
increased whole-bank delayed recall by 0.1314 versus adaptive-paced, while removing
only the introduction budget produced identical choices and outcomes. Outside exploration at
0.05 increased delayed recall by 0.0900; the two seed-level paired differences
ranged from 0.0657 to 0.1142. These are development diagnostics, not held-out claims.

Before any held-out execution, the coordinator reviewed the screen and selected
exactly **adaptive-paced, uniform-hard, outside-exploration-.05**. This retains the
current reference, a broad hard-eligible benchmark and the smallest bounded
candidate. No-frontier explains the dominant screened access restriction, but
complete frontier removal is too broad a production candidate for this shortlist.
All score weights remain fixed. The choice is not an automatic winner ranking.

The [held-out plan](studies/heldout-plan.json) remains unchanged: three new seeds,
four matched profile/goal cells, six staged scenarios and three selected policies,
for 216 runs. Its independently authored fixture and spacing/low-benefit model
hypotheses predate screening. Exact executable/config/fixture hashes and the
shortlist are persisted by the manual freeze command in
`artifacts/learning-evaluation/policy/investigation-freeze/results.json` before
the held-out command runs. See [README.md](README.md) for exact commands and
interpretation limits.

Perfect versus observable-real changes both probability availability and the
synthetic-versus-real evidence path. It is a combined sensitivity check, not an
isolated causal estimate of probability availability. Primary metrics remain
delayed whole-bank and goal-weighted recall; profile/goal cells are paired within
seed and do not count as independent random replications.

## Executed checks and frozen provenance

- Both the post-extension and final pre-freeze reproduction matched all **120
  complete original runs and the configuration exactly**. Final verification is
  `artifacts/learning-evaluation/policy/investigation-reproduction-final/results.json`.
- The two focused correctness files passed **30 tests**, covering baseline parity,
  observed-input privacy, real reducer invocation, fixed-model preservation,
  spacing and low-benefit hypotheses, paired seed denominators, access support,
  configuration/freeze validation, import safety and bounded JSON serialization.
- Freeze timestamp: `2026-09-20T10:41:22.242Z`.
- Frozen plan SHA-256:
  `eccb04b40750ded94db0db9631d960470bd6bc2a674fe0fba57d6a43a2d099b6`.
- Screen JSON-content SHA-256:
  `88e015c65ad8dc8d25142bf2d46ee33a88a2465b0ca73f74695738cf84126b9b`.
- The frozen **216 held-out runs completed**, with source hashes checked again
  afterward. Their readable report and complete JSON are
  `artifacts/learning-evaluation/policy/investigation-heldout/report.md` and
  `artifacts/learning-evaluation/policy/investigation-heldout/results.json`.
  No hypotheses, primary outcomes, score weights or shortlist changed afterward.

## Controlled screen findings

Mean delayed probabilities on the original development fixture:

| Policy | Whole bank | Goal weighted | Exposure coverage | Mean available set |
| --- | --- | --- | --- | --- |
| Uniform paced | 0.2926 | 0.3173 | 0.5486 | 1.7569 |
| Adaptive paced | 0.2977 | 0.3279 | 0.5694 | 1.8035 |
| Uniform hard only | 0.4398 | 0.4341 | 1.0000 | 12.0000 |
| Adaptive hard only | 0.4169 | 0.4884 | 0.9861 | 12.0000 |
| No frontier | 0.4290 | 0.4859 | 1.0000 | 6.8326 |
| No introduction budget | 0.2977 | 0.3279 | 0.5694 | 1.8035 |
| No slots | 0.2905 | 0.3300 | 0.5139 | 3.8715 |
| Outside exploration 0.05 | 0.3876 | 0.4293 | 0.9306 | 12.0000 |

Scoring within the paced generator changed delayed recall by only +0.0051 in
this screen; changing access under otherwise retained adaptive scoring changed
it much more. This supports an access explanation **within this fixed simulator**,
especially the frontier control. It does not attribute the entire performance
gap to pacing in general. Adaptive hard-only scoring traded lower whole-bank
recall for higher goal-weighted recall than uniform hard-only selection. Removing
slots alone did not improve whole-bank recall. The introduction-budget ablation
had no effect here, so this screen gives no evidence for changing that budget.

## Held-out outcomes and tradeoffs

Values below are paired differences for outside exploration 0.05 minus the
unchanged adaptive-paced reference. Each scenario contains 12 matched cells
but only **three seed units**; cells are averaged within seed before the SD/range.

| Scenario | Whole-bank difference | Seed SD | Seed-mean range | Goal difference |
| --- | --- | --- | --- | --- |
| 10 days, fixed, perfect | +0.0913 | 0.0066 | +0.0862 to +0.0988 | +0.1117 |
| 10 days, fixed, observable | +0.0836 | 0.0155 | +0.0686 to +0.0995 | +0.1031 |
| 36 days, fixed, perfect | -0.0012 | 0.0025 | -0.0027 to +0.0017 | +0.0019 |
| 36 days, fixed, observable | +0.0005 | 0.0017 | -0.0012 to +0.0022 | +0.0050 |
| 36 days, spacing, observable | +0.0202 | 0.0140 | +0.0092 to +0.0360 | +0.0164 |
| 36 days, low benefit, observable | -0.0022 | 0.0005 | -0.0025 to -0.0016 | -0.0020 |

The small 36-day fixed observable aggregate conceals opposing subgroup effects:
whole-bank differences were -0.0060 for novice/daily-life and -0.0099 for
novice/work, versus +0.0119 for returning/work and +0.0060 for supported/daily-life.
Even under the spacing hypothesis, novice/work averaged -0.0033 while the overall
paired difference was positive. The full report retains each subgroup and seed.

The broad uniform benchmark still had higher whole-bank delayed recall in the
fixed and spacing scenarios. At 36 days with observable inputs it scored 0.4761
versus adaptive-paced 0.4490, but lower goal-weighted recall, 0.4759 versus 0.4965.
Under the low-benefit hypothesis adaptive-paced instead led uniform by 0.0036
whole-bank and 0.0077 goal-weighted recall; every policy lost recall over the run.
These changes of tradeoff reinforce that the hypotheses, goals and horizon matter.

## Access and evidence observations

In the 10-day observable scenario, the unchanged policy admitted and selected
half of the 12 hard-eligible assessment IDs on average; mean per-slot support was
1.7444. It left all six difficulty-2 IDs outside support throughout each run.
Outside exploration gave all 12 IDs positive support, but selected only 86.11%
and independently assessed 83.33% on average. Support is not realized coverage:
the uniform outside route contributes only `0.05 / 12` probability per ID.

For the unchanged policy's 1,440 short observable interactions, frontier
predicates excluded 12,922 item-slots and slot allocation excluded 14,768.
These sets overlap; the counts cannot be summed. Introduction-budget exclusions
were zero. Empty review/practice/new category fallbacks occurred 387/16/249 times;
the nearest-challenge reservation was reported 36 times. The outside variant
selected beyond its ordinary paced support on 41 turns. These measurements
describe this single-item simulator, not full game boards.

By 36 days every shortlisted policy had selected and independently assessed
every eligible ID in every held-out run. Unchanged adaptive pacing therefore
showed short-run delay, **not a permanent inaccessible region in this fixture**.
Its longest unchanged computed frontier while harder material existed was about
four days. For controls disabling or bypassing the frontier, an unchanged
computed frontier is not itself an active access restriction. Read actual support
and restored IDs together with the predicate trace.

The short schedule ran January 5–14, with 12 interactions per day two minutes
apart; the longer schedule ran January 5–February 9. Both probe seven days after
the final interaction. Short adaptive observable runs reached at most 10 practice
days, two recorded independent days and one spaced success per item; the longer
fixed observable runs reached at most 27/7/6 respectively. These are stored
scheduling-evidence counters, not estimated mastery or reconstructed assessment
denominators.

Modality opportunities were identical between policies within each matched cell:
in the short held-out scenarios, exposure/assisted/independent shares averaged
8.68%/19.51%/71.81%; in longer scenarios they averaged 9.74%/18.63%/71.62%.
Each assisted or independent encounter assessed one item; exposure assessed none.
No human-effort cost model was added.

In short observable runs, the reference's recent repetition was 89.58%, versus
69.79% with outside exploration and 35.14% for uniform. Corresponding mean due
backlogs were 0.6750, 2.2486 and 6.4778 items, and unassessed-item attention was
6.94%, 13.06% and 13.96%. Broader access increases review obligations along with
coverage. In long fixed observable runs, whole-run repetition converged to 97.22%
for all three policies because each covered the same 12 IDs over 432 turns;
recent repetition still differed (50.71%, 43.75%, 35.80%).

Weakness probability availability was 100% in perfect inputs and 0% in observable
inputs. Selected challenge sources changed from supplied response probability to
the explicit editorial-frontier heuristic. The real reducer/adapter received
only observed events. Hidden retrieval truth remained inside the evaluator's
outcome metrics, never its observable policy inputs. Missing-evidence indicators
remained heuristic indicators, not calibrated uncertainty.

## Interpretation for the coordinating decision

The evidence supports inspecting candidate access before tuning scores and shows
why a ten-day comparison penalized conservative pacing in the fixed simulator.
It does not demonstrate a permanent progression defect in the held-out bank or
a robust benefit from changing production defaults. The bounded outside route
helps short-run coverage and simulated recall, but its longer-run effect is
mixed across models and subgroups and it increases short-run due backlog.
Retaining the current production default is consistent with these results.

Remaining ambiguity is substantive: the simulator has no independently validated
challenge benefit, no pedagogical cost of early exposure to advanced tasks, and
no measured human learning or effort. Its spacing hypothesis can favor distributed
broad practice; adding it is not proof of that mechanism. The combined
perfect/observable comparison cannot separate score-feature availability from
history projection. If that distinction becomes decision-relevant, the smallest
next diagnostic is matched real-reducer histories with probability features
masked versus supplied, without changing policies or collecting new fitted scores.
