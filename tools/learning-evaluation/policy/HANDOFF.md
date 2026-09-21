# Evaluator B handoff

Implemented in the canonical checkout on `main`; no branches, worktrees,
commits, publication, service changes, container configuration changes or host
dependency installation. The initially stopped `caatuu-dev` was started by the
user; inspection confirmed its running `/workspace` bind is `C:\Work\caatuu`.
Concurrent changes outside this directory were preserved.

## Changed files

All source additions are under `tools/learning-evaluation/policy/`:

- [run.mjs](run.mjs): independent manual CLI, source provenance, constrained ignored outputs.
- [runner.mjs](runner.mjs): hard eligibility, per-run injection, paired runs, metrics and distributions.
- [policies.mjs](policies.mjs): uniform, actual existing scheduler, usefulness baseline and external production adapter loader.
- [environment.mjs](environment.mjs): independent response, learning, forgetting and bounded explicit transfer.
- [evidence.mjs](evidence.mjs): synthetic ordered encounter projection into scheduler history.
- [random.mjs](random.mjs): reproducible policy stream and independent keyed environment draws.
- [fixture.json](fixture.json): 14 synthetic items, 12 default-eligible items, three profiles, two goals.
- [config.json](config.json): seed set, budget, timing and configurable diagnostic assumptions.
- [report.mjs](report.mjs): Markdown output, definitions and limitations.
- [policy.test.mjs](policy.test.mjs): 19 software-correctness tests; no pedagogical ranking assertions.
- [README.md](README.md): complete command, interface, model and metric contracts.
- [HANDOFF.md](HANDOFF.md): this execution record.

Generated files remain ignored:
`artifacts/learning-evaluation/policy/{default,smoke}/{results.json,report.md}`.

## Public interfaces

`runner.mjs` exports async `runEvaluation({config, fixture, policies?})` and
`simulateRun({config, fixture, profile, goal, seed, policy})`, plus
`validateInputs(config, fixture)` and `eligibleCandidates(fixture, config)`.

Each injected policy is `{id, label, create()}`. A fresh per-run factory returns
`{select(input)}`; selection returns an eligible ID. Input contains identity,
the full hard-eligible bank, that run's evidence and perfect current synthetic
recall, selected goal, time, seeded randomness, badge ceiling and minimum pool.
The [README interface table](README.md#public-interfaces-and-ownership) documents
every export and exact selection shape.

`--production-adapter PATH` expects `createPolicy()` and
`policyMetadata = {label, implementation}`. Its implementation must delegate to
the integration owner's actual production policy. No substitute adaptive policy
was implemented. Production comparison is explicitly **pending** in both reports.

## Actual checks and commands

Executed in the established container (Node v22.23.2):

```powershell
docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/policy/policy.test.mjs apps/language-runtime/tests/content-progression.test.mjs apps/language-runtime/tests/content-progression-games.test.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --interactions 12 --seeds 17 --profiles novice --goals daily-life --out smoke
```

- Combined tests: **42/42 pass** (19 evaluator, 23 existing scheduler/game).
- Repository file policy: passed for 2,775 tracked/candidate paths at that check.
- Repository Markdown check, including final recheck: failed only on the
  concurrently authored content evaluator README link to its missing
  `HANDOFF.md`; no other evaluator files were edited to address it.
- Default experiment: **90 completed runs**, 120 interactions each, five paired
  seeds, three profiles and two goals, across the three existing baselines.
- Smoke overrides: **3 completed runs**, 12 interactions each. Repeated the exact
  smoke command and compared SHA-256 of both output files: JSON and Markdown
  were byte-identical.
- `git diff --check` passed; `git check-ignore` confirms default report outputs
  are ignored. Main-only checks found `refs/heads/main` and
  `refs/remotes/origin/main` only, using the canonical checkout.

No production comparison, estimated-state mode, real-learner experiment,
optimal-sequence comparison or publication was executed.

## Default-run results

Means across the 30 profile/goal/seed runs per baseline:

| Metric | Uniform | Existing selector | Usefulness weighted |
| --- | --- | --- | --- |
| Immediate learning gain | 0.4121 | 0.2014 | 0.4028 |
| Seven-day recall | 0.4408 | 0.2971 | 0.4342 |
| Goal progress | 0.4202 | 0.2435 | 0.4331 |
| Eligible-item coverage | 1.0000 | 0.5611 | 1.0000 |

These are simulator probabilities and probability differences, not observed
human learning gains. The fixed half-lives, learning factors, synthetic sparse
bank and single-item loop limit interpretation. Markdown/JSON preserve spread
across seeds, profiles and goals, all metric definitions, assumptions and paired
differences. There is no optimal reference or regret claim.

## Remaining integration

The integration owner must supply the thin bridge to the finalized real
production policy, preserve its source revision and run the four-policy
comparison. This is the only missing requested policy comparison; it is not
replaced by a fabricated adaptive baseline.

Evaluator B requires no run or output from A or C and no production estimator.
No central test registration change is required for manual use. Any desired
registration of the focused correctness test belongs to the integration owner.
Do not register simulation runs or pedagogical thresholds in default tests, CI,
release gates, schedules, telemetry or services.
