# Adaptive learning: milestone checkpoint

21 September 2026. This phase is complete. This checkpoint preserves the
implementation and existing research; it starts no new learning objective and
does not publish a website or APK. The previous source checkpoint is
`f91554334e0c4a5a9e3f9d2e021519881d3516d3`; this document is committed with the
completed follow-up work on canonical `main`.

## Implemented and production behavior

22 September follow-up: difficulty now filters to the exact selected level
before progression and adaptive scoring. Previously the cumulative ceiling
could keep presenting level-1 material after selecting level 3. Game answers,
distractors and Word World suggestions now respect the selected band, including
recent-history fallback. Difficulty changes in another tab also refresh active
practice. Saved evidence and Stats still cover all practiced levels. Pacing and
score coefficients remain unchanged. The retained experiments below used the
earlier cumulative rule; they are historical evidence, not fresh measurements
of this correction.

Focused reproduction of the difficulty correction:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/selected-difficulty.test.mjs apps/language-runtime/tests/adaptive-game-integration.test.mjs apps/language-runtime/tests/content-difficulty-selection.test.mjs apps/language-runtime/tests/word-world-progression.test.mjs apps/language-runtime/tests/product-word-world-semantic.test.mjs apps/language-runtime/tests/learning-goals.test.mjs
```

The regression checks passed, including all five courses and supported games.
The local Norwegian browser also changed from a level-3 sentence to level 1
immediately on a badge change. Offline metadata/cache revisions were refreshed
and checked for all five courses. No policy experiments or publication ran.

- One shared adaptive sampler serves manifest-supported game paths across
  Czech, Mandarin, Spanish, Spanish-to-English and Norwegian Bokmål. Course
  content and capabilities determine availability. Exact difficulty filters,
  answer-equivalence groups and playable-board constraints remain enforced.
- Current production pacing remains the default: existing feature weights,
  temperature 0.7, 15% within-pool exploration, frontier, introductions and
  review/practice/new slots. No coefficients or progression defaults were
  retuned at closure. Gameplay and evaluator bridges share the same four most
  recently seen distinct identities.
- Goals persist per course and influence future sampling. Changing a goal
  does not rewrite learning records or reshape recorded practice evidence.
- Stats and the seven-topic practice polygon use one shared implementation.
  The map accumulates distinct practice evidence; independently assessed items
  remain distinct from assisted/exposure evidence and include unaided mistakes.
  It measures neither mastery, accuracy, recall probability nor course completion.
  Topic and game details remain available in the shared Stats dialogs.
- Existing difficulty-change handling now replaces the active noun-practice
  queue without crediting an unfinished attempt or losing completed evidence.

The [design and formulas](ADAPTIVE_LEARNING.md) and
[mapping audit](PRACTICE_MAPPING_AUDIT.md) describe the implementation. Mapping
thresholds, saturation formulas, anchors and evidence interpretation are
unchanged by this checkpoint.

## Experimental boundary and limitations

The softer progression limit remains an explicit evaluator experiment, disabled
in production. Its unseen-item penalty is
`2 * max(0, (position - frontier) / 100)` after admitting items beyond the hard
frontier through the remaining introduction and playability rules. Outside-pool
exploration and cross-category repeat avoidance also remain experimental.

The [runtime-aligned investigation](ADAPTIVE_POLICY_RUNTIME_ALIGNMENT.md) retains
the completed 540 runs, frozen variants and mixed results. The soft variant
improved early breadth and variety but did not consistently improve longer
recall outcomes. These are synthetic research results, not evidence of human
learning benefit or permission to promote a new production default.

Important limits:

- Learner state exposes retained evidence and scheduler/readiness heuristics;
  there is no calibrated mastery or recall estimator. A later supported attempt
  can obscure an earlier independent error in the retained summary.
- English audit meanings drive semantic mapping. Topic overlap, unmatched
  meanings, guard exclusions, missing identities and unavailable vectors remain
  explicit. Sparse topic matches are not proof of absent learning.
- Mapping uses singleton encoding to avoid batch-companion dependence, with a
  distinct cache recipe. CPU and browser backends are not bitwise identical.
- Policy studies use small previously studied fixtures, fresh seeds and one
  assessment per turn. They do not reproduce every board, optional semantic
  feature, goal mode or human effort/frustration effect.
- Content inspection distinguishes authored records, playable units and unique
  English meanings. It does not certify target-language correctness or missing
  curriculum topics without an explicit reference.

## Three independent manual evaluators

| Tool | Purpose |
| --- | --- |
| [A: learner state / Stats](../tools/learning-evaluation/stats/README.md) | Exercise the real persistence reducer and evidence adapter with scripted learners; optional polygon diagnostics and saved-profile replay. |
| [B: policy](../tools/learning-evaluation/policy/README.md) | Compare selectors under paired synthetic conditions; distinguish perfect state from production-observable evidence and freeze studies before confirmation. |
| [C: content](../tools/learning-evaluation/content/README.md) | Inspect course inventories, grading, missingness, duplicates and bounded English semantic comparisons; optional real practice-map audit. |

They do not depend on running one another and are not automatic learning-quality
CI/release gates. The [tool guide](../tools/learning-evaluation/README.md) is linked
from course onboarding, content editing and repository instructions.

## Reproduction commands

Run from `C:\Work\caatuu` on `main`, with the existing running `caatuu-dev`
container bound to `/workspace`. No host dependency installation is needed.

```powershell
docker inspect caatuu-dev --format '{{.State.Status}} {{json .Mounts}}'
$evaluationRun = Get-Date -Format 'yyyyMMdd-HHmmss'

# A: the small correctness fixture; --semantic uses controlled vectors.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic --name $evaluationRun-stats

# B: the existing production-vs-baseline simulator (perfect synthetic state).
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --out $evaluationRun-policy

# C: small software fixture without model inference.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --fixture --no-semantic --output artifacts/learning-evaluation/content/$evaluationRun-fixture

# C: reproduce the scope of the retained Mandarin inspection when requested.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --config tools/learning-evaluation/content/config.json --courses zh --max-documents 4096 --output artifacts/learning-evaluation/content/$evaluationRun-zh
```

The last two research commands (B and full Mandarin inspection) are documented
for later reproduction; they were not rerun for closure. B's README gives the
exact screen/freeze/confirmation commands and observable-state plans. Use new
output names: B overwrites reused names; A and C preserve existing directories.
C's 4096-document cap is not a promise of full semantic coverage for future banks.

Final correctness/integration commands, run once as four groups:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/adaptive-sampling.test.mjs apps/language-runtime/tests/adaptive-access.test.mjs apps/language-runtime/tests/adaptive-experiment-controls.test.mjs apps/language-runtime/tests/adaptive-game-integration.test.mjs tools/learning-evaluation/policy/runtime-inputs.test.mjs tools/learning-evaluation/policy/policy.test.mjs tools/learning-evaluation/policy/investigation.test.mjs

docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/learning-goals.test.mjs apps/language-runtime/tests/learner-state.test.mjs apps/language-runtime/tests/content-exposure-persistence.test.mjs apps/language-runtime/tests/course-practice-summary.test.mjs apps/language-runtime/tests/practice-compass.test.mjs apps/language-runtime/tests/practice-mapping-reliability.test.mjs apps/language-runtime/tests/course-stats-ui.test.mjs apps/language-runtime/tests/skill-compass-language-boundary.test.mjs apps/language-runtime/tests/learning-semantics.test.mjs

docker exec -w /workspace caatuu-dev node --test tools/learning-evaluation/content/corpus.test.mjs tools/learning-evaluation/content/semantic-cache.test.mjs tools/learning-evaluation/content/metrics.test.mjs

docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/noun-landing-behavior.test.mjs apps/language-runtime/tests/content-difficulty-selection.test.mjs apps/language-runtime/tests/campaign-coverage.test.mjs apps/language-runtime/tests/app-readiness.test.mjs apps/language-runtime/tests/embedding-runtime-contract.test.mjs apps/language-runtime/tests/interface-content.test.mjs apps/language-runtime/tests/interface-content-coverage.test.mjs apps/language-runtime/tests/spanish-interface-content.test.mjs tools/language-packs/tests/course-contract.test.mjs tools/language-packs/tests/generated-views.test.mjs apps/server/tooling/tests/refresh-setup-assets.test.mjs
```

Results: **97 policy/integration, 111 Stats/goals, 30 content and 175
course/runtime tests passed**, with no failures. A's closure fixture passed
92 invariants and 15 polygon checks, with zero unsupported confidence claims
across 154 states. C's closure fixture completed with semantic inference disabled;
its deliberately missing/invalid fields and unavailable banks are expected.

Two narrow closure corrections were made: package/cache the new shared
recent-history dependency, with matching offline worker revisions; and restore
the existing evidence explanation inside Stats details. The packaging regression
test follows the actual import graph and every browser course. These fixes and
the relevant service-worker boundary passed **42 focused checks**; that total
includes reruns of the affected tests, not 42 additional independent tests.

```powershell
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/adaptive-game-integration.test.mjs apps/language-runtime/tests/skill-compass-language-boundary.test.mjs apps/server/tooling/tests/semantic-learning-contract.test.mjs apps/server/tooling/tests/service-worker-navigation.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
git diff --check
```

The course/view validation, final setup-integrity check for all five courses,
repository file policy, Markdown links and whitespace checks passed.

## Preserved reports and checkpoint scope

Reports remain local under ignored `artifacts/learning-evaluation/`. Each result
directory contains `report.md` and `results.json`; content runs also retain
`corpus.json`. Do not commit generated experiments, model caches or captured
learner histories. Source/configuration/model provenance stays in the JSON.

| Relative directory | Retained evidence |
| --- | --- |
| `stats/full-semantic-20260921-153617/` | 12 learners × 12 rounds; 1,118 invariants passed; controlled semantic vectors. |
| `content/zh-full-20260921T133700323Z/` | 2,741 playable units; all 2,117 eligible unique English meanings inspected; 15 guard exclusions. |
| `policy/runtime-aligned-20260921-{original,screen,freeze,confirmation}/` | Corrected benchmark, 60-run screen, pre-confirmation freeze and 360-run confirmation. |
| `policy/runtime-aligned-20260921-summary.json` | Compact numeric results and paired-input audit. |
| `content/mapping-audit-{baseline,deterministic,warm}-20260921/` | Mapping diagnosis and reproducibility evidence; see the mapping audit for profile sensitivity and exact scope. |
| `checkpoint-20260921/` | Final test logs, initial offline findings, corrections and validation outputs. |
| `stats/checkpoint-20260921/`, `content/checkpoint-20260921-fixture/` | Closure-only A and C correctness fixtures. |

SHA-256 of the principal retained `results.json` files:

```text
stats/full-semantic-20260921-153617: 5e11d08ad92b9c48004a236c98bcb665aba21e549dad6026dfe8b5f41a0e7653
content/zh-full-20260921T133700323Z: 56887781f6872e84fe308b7f054c3ba1d7ab37b47b8862ccc58725fef94e53ad
policy/runtime-aligned-20260921-freeze: e6a13d2c0126508eb4d61dceaacc55e0691e305db8c93c6dfe26a91ed9fdc4c8
policy/runtime-aligned-20260921-confirmation: 2c086a89881c14dc7eae523ea9e58d11f0e7a6d652b17e77c3ed682a7193b6d8
```

The commit contains only adaptive-learning, Stats, the noun difficulty repair,
their tests/documentation and necessary offline declarations. Separate startup,
speech, maintenance/update, Word World and Android release-tool work remains
uncommitted. Mixed Chrome/interface/setup files are staged selectively; their
unrelated working-tree additions and matching hashes are preserved. Correctness
commands above ran in the canonical shared checkout; no alternate checkout or
publication was used.

## Single deferred research direction

**Before attempting a real human-learning comparison, add durable
first-response/support evidence so that an unaided first mistake cannot later
be obscured by hints, retries or assisted completion.**

This is deferred work, not part of this checkpoint. No real-user study, mastery
estimator, telemetry, scheduling, dashboard, semantic infrastructure or further
policy search was started.
