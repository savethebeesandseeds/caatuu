# Policy experiments with gameplay recent-history input

This manual follow-up to the [candidate-access investigation](ADAPTIVE_POLICY_INVESTIGATION.md)
was specified on 21 September 2026 after discovering that evaluator B's bridge
omitted gameplay's four most recently seen identities. All experimental selection
rules remain shared across courses. Production coefficients and default access
rules are unchanged.

## Input correction

Gameplay and both evaluation bridges now import the same recent-history helper.
It orders bank identities by lastSeenAt, preserves insertion order for ties, and
returns at most four distinct identities. This is not the five-turn window used
to report recent repetition. A focused regression compares the actual gameplay
wrapper and both bridges with identical histories, including score contributions
and selection distributions.

Earlier reports remain historical measurements under their recorded inputs. They
must not be described as exact gameplay repetition rates. The ordinary evaluator
report now identifies its actual perfect or observable state mode explicitly.

This comparison still represents one assessment item per turn, with optional
semantics unavailable. It does not reproduce complete game boards, Word World's
separate exclusions or word filters, grouped scheduling histories, or all of the
Review/Reinforce/Explore goal modes. Both synthetic fixtures contain 12 eligible
items. Real-catalog integration checks establish playability separately.

## Predeclared variants and outcomes

The following five variants are declared before outcome inspection, with no
coefficient fitting or outcome-based shortlist selection:

| Variant | Change |
| --- | --- |
| adaptive-paced | Current production selector with corrected recent-history input. |
| uniform-hard | Uniform selection across all valid items under the selected badge. |
| outside-exploration-.05 | 95% of current conditional distribution plus 5% uniform across all remaining hard-eligible items. |
| soft-frontier | Admit unseen items beyond the frontier through the existing introduction/category rules; subtract 2 × max(0, (position − frontier)/100) from unseen-item scores. |
| cross-category-recency | If the selected category has no unrecent/unexcluded candidate, try another otherwise permitted category before allowing a repeat. |

The soft-frontier variant removes associated nearest-band reservations and
one-challenge caps so they cannot reinstate hard frontier exclusion. The badge,
answer-group validity, introduction allowance and minimum playability constraints
remain. Existing feature weights, temperature and 15% within-pool exploration are
unchanged. Repeat avoidance is tested alone, not combined with other interventions.

Primary outcomes are seven-day delayed whole-bank and goal-weighted recall.
Coverage, recent repetition, due-review backlog, access and modality/evidence
diagnostics are retained. Comparisons pair identical scenario/profile/goal/seed
cells, average differences within a seed, and report the seed spread. These
descriptive synthetic results do not establish human learning benefits.

## Execution plan

- Original-fixture screen: two fresh seeds (503, 607), all three learner profiles
  and both goals, five policies, 120 interactions: 60 runs.
- Save a freeze containing all five predeclared variants and exact shared source
  hashes before the confirmation stage. Reject shared source changes between the
  screen, freeze and subsequent execution.
- Confirmation: existing previously studied comparison fixture, fresh seeds
  709/811/907, all six profile/goal cells, all five policies. Four observable-state
  scenarios: 120 interactions with fixed forgetting; 432 interactions with fixed,
  spacing, or low-benefit learning assumptions: 360 runs.
- Each day has 12 interactions two minutes apart; horizons are 10 and 36 days.
  The delayed probe remains seven days after the last interaction.

This is fresh-seed confirmation on existing content, not unseen-content validation.
The simulator hypotheses are unchanged and were authored independently of these
new selectors. All source changes and runs use canonical main in the established
caatuu-dev container. No release or automatic production-policy promotion is part
of this experiment.

Reproduction instructions are in the [evaluator README](../tools/learning-evaluation/policy/README.md).

## Results and decision

All 540 runs completed: 120 original-benchmark input-correction runs, 60 screening
runs and 360 frozen confirmation runs. No parameters were changed after observing
outcomes. Keep production defaults unchanged: no tested variant consistently
improves both primary outcomes across the longer learning assumptions. The soft
frontier is the leading adaptive candidate for earlier breadth and variety.

The corrected original benchmark changes current adaptive delayed recall from
29.5529% to 29.5726%, goal recall from 32.5584% to 32.2113%, and recent repetition
from 83.7222% to 85.1667%. All 90 non-adaptive baseline trajectories reproduce
exactly. The missing input was a fidelity problem, but does not explain away the
original recall deficit.

The following results use the existing comparison fixture and fresh confirmation
seeds, not the original fixture. Each cell averages 18 profile/goal/seed runs.

| Policy | 10-day delayed recall | 10-day goal recall | 36-day fixed delayed recall | 36-day fixed goal recall |
| --- | ---: | ---: | ---: | ---: |
| Current adaptive | 27.81% | 26.26% | 46.62% | 50.81% |
| Uniform | 43.59% | 43.19% | 48.57% | 48.41% |
| 5% outside exploration | 36.95% | 36.94% | 46.53% | 50.72% |
| Soft frontier | 42.97% | 47.32% | 46.29% | 50.95% |
| Cross-category recency | 27.94% | 26.56% | 46.72% | 50.67% |

All probes occur seven days after the final practice. The confirmation policies
retain the declared 12 interactions/day and two-minute within-day schedule.

Soft frontier improves early whole-bank recall in all six profile/goal groups.
At 10 days it reaches 100% coverage versus current pacing's 50%, and recent
repetition falls from 90.88% to 31.90%. Mean scheduled review backlog rises from
0.70 to 5.18 items. This count is a scheduler diagnostic, not measured human effort.
The 5% route reaches 85.65% coverage and 64.03% repetition. Cross-category recency
alone remains at 50% coverage and increases repetition to 92.04%.

Longer results prevent a universal improvement claim:

| 36-day assumption | Current recall / goal recall | 5% route recall / goal recall | Soft frontier recall / goal recall |
| --- | ---: | ---: | ---: |
| Fixed forgetting | 46.62% / 50.81% | 46.53% / 50.72% | 46.29% / 50.95% |
| Spacing improves memory stability | 69.17% / 75.63% | 71.49% / 76.90% | 71.36% / 77.61% |
| Low learning benefit per practice | 6.56% / 6.65% | 6.29% / 6.32% | 6.09% / 6.04% |

By day 36, every policy has full exposure and independent assessment coverage.
The early restriction is a delay under this schedule, not permanent exclusion.

In long fixed runs, soft frontier loses whole-bank recall in five of six subgroup
means: novice/work loses 0.74 percentage points and returning/work loses 1.44
points, with all three seeds negative in both groups. Every soft-frontier subgroup
loses under the low-benefit hypothesis. Cross-category recency has no consistent
benefit and loses 1.56 points on average for supported/daily-life under spacing
(one seed loses 5.44 points).

Paired soft-frontier minus current changes (percentage points) retain seed-level
variation rather than treating all 18 cells as independent replication:

| Scenario | Whole-bank mean [seed-mean range] | Goal mean [seed-mean range] |
| --- | ---: | ---: |
| 10-day fixed | +15.16 [+14.87, +15.51] | +21.06 [+20.94, +21.14] |
| 36-day fixed | -0.33 [-0.86, +0.04] | +0.13 [+0.08, +0.16] |
| 36-day spacing | +2.19 [+1.54, +2.65] | +1.98 [+0.93, +3.03] |
| 36-day low-benefit | -0.47 [-0.50, -0.45] | -0.61 [-0.64, -0.56] |

Three fresh seed units on previously studied 12-item fixtures support descriptive
comparison only. Semantic features, human effort, motivation, challenge-dependent
learning and actual multi-item board trajectories remain unmeasured. Broader
selection has no modeled frustration/dropout cost here. These results are not
human efficacy estimates or justification for tuning weights to win this simulator.

A useful next decision is whether earlier breadth and variety warrant taking soft
frontier into a prospectively specified real-learner comparison with independent
delayed probes and durable first-response/support evidence. A staged or
backlog-aware widening rule would be a new, untested proposal. No additional
variants were added after observing these results.

## Verification and artifacts

- 97 focused software tests passed, including production-default preservation,
  evaluator/gameplay input parity, experiment boundaries, and playable real
  catalogs across all five courses and all three difficulty badges.
- The result audit passed 1,680 checks of paired initial knowledge, eligibility,
  schedules and modality sequences; all 1,260 saved study input snapshots matched
  the recent-history helper and omitted latent learner probabilities.
- All recorded screen and confirmation source hashes still matched after execution.
- All 90 untouched original baseline trajectories reproduced exactly.
- Repository file-policy and Markdown-link checks passed. Only main exists locally
  and as a remote-tracking branch.
- This work does not change production default policy behavior or publish an APK.

Freeze: 2026-09-21T14:08:36.900Z.
Plan SHA-256:
`182193c3bc6db2b02b1f8b03bcb69c616433fa77b8a8aeb945b661d466c77c84`.

Local outputs under `artifacts/learning-evaluation/policy/`:

- `runtime-aligned-20260921-original/`: corrected original benchmark.
- `runtime-aligned-20260921-screen/`: 60-run screen.
- `runtime-aligned-20260921-freeze/`: pre-confirmation source/plan freeze.
- `runtime-aligned-20260921-confirmation/`: 360-run results and full report.
- `runtime-aligned-20260921-summary.json`: compact numeric results and audit.
- `runtime-aligned-20260921-analysis.mjs`: streaming audit of large result files.

Each run directory contains `report.md` and `results.json`. Raw outputs are
ignored local artifacts; the maintained entrypoint and checked-in plans reproduce
the experiment with new output names.
