# Manual learning evaluation tools

Start here when adding a language, expanding or inspecting content, changing
adaptive selection, or investigating Stats and its practice polygon. These
three independent tools serve the shared application across courses. Choose
the tool that answers the question; none requires running the other two.

The [milestone checkpoint](../../docs/ADAPTIVE_LEARNING_CURRENT_STATE.md) records
the current production decision, completed checks, retained reports and deferred work.

| Question | Tool | What it reports |
| --- | --- | --- |
| Is a new or edited course's content consistent and varied? | [C: content inspection](content/README.md) | Authored and playable inventories, missing fields, difficulty/usefulness/complexity distributions, duplicates, English semantic neighbors and possible grading gaps. |
| Does the sampling policy select useful practice under controlled assumptions? | [B: policy evaluation](policy/README.md) | Paired synthetic comparisons of delayed recall, goal recall, coverage, repetition and review burden; includes frozen candidate studies. |
| Do saved learning events and Stats preserve the evidence they claim? | [A: learner state and Stats](stats/README.md) | Real reducer/state-adapter checks with scripted learners; optional shared practice-polygon diagnostics and saved-profile replay. |

For course onboarding or content edits, begin with C. A and B address changes
to learner evidence and selection behavior; adding a course does not require
running all three. The tools use declared course resources and shared adapters.
A new game or content-field contract may require a shared adapter extension;
missing or unsupported data must remain visible in the report.

## Run a relevant inspection

Run from canonical `C:\Work\caatuu` on `main`, using the existing running
`caatuu-dev` container. Verify that `/workspace` binds this checkout first:

```powershell
docker inspect caatuu-dev --format '{{.State.Status}} {{json .Mounts}}'
```

Use a fresh run name to preserve previous results. These examples are separate
manual choices, not a required pipeline:

```powershell
$evaluationRun = Get-Date -Format 'yyyyMMdd-HHmmss'
$courseId = 'zh' # Replace with the registered course ID being reviewed.

# C: inspect the selected course's full metadata without loading a model.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --courses $courseId --no-semantic --output artifacts/learning-evaluation/content/$evaluationRun-metadata

# C: add a reproducible sample of English semantic comparisons.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --courses $courseId --output artifacts/learning-evaluation/content/$evaluationRun-semantic

# A: small scripted learner-state run, including polygon diagnostics.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/stats/run.mjs --fixture --semantic --name $evaluationRun-stats

# B: compare baselines with the production selector in the default simulator.
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/policy/run.mjs --production-adapter tools/learning-evaluation/production-policy.mjs --out $evaluationRun-policy
```

C accepts comma-separated IDs through `--courses`; omit it to inspect all
registered courses. Metadata traversal is complete for the selected courses,
while the default semantic sample is capped at 384 unique English documents.
`--max-documents 4096` raises that cap; check the reported eligible and selected
counts before calling a semantic run complete. Semantic inspection requires
the existing pinned local model and dependencies; it does not download them.

A's `--semantic` fixture uses controlled vectors, not model inference. B's
default comparison supplies perfect synthetic probabilities; its README
documents `observable-real` studies using only production-observable evidence.
B does not automatically become a language-specific learner simulation when
C inspects that language.

## Read and retain the results

Each tool writes readable `report.md` and detailed `results.json` beneath
ignored `artifacts/learning-evaluation/{stats,policy,content}/`; C also writes
`corpus.json`. A and C preserve existing run directories; B overwrites results
when an output name is reused. Keep generated reports, model caches and saved
learner profiles out of Git. The individual READMEs document configurations,
seeds, source/model provenance and interpretation limits.

These are manually invoked diagnostics, not automatic CI or release gates.
Content findings support linguistic review but do not certify translation
quality or curriculum completeness. Simulated policy gains do not establish
human learning gains; practice-polygon values describe evidence, not mastery.
Keep the existing course/content validators and publication reviews in place.

For deeper investigations, see the [shared learning design](../../docs/ADAPTIVE_LEARNING.md),
[practice-mapping audit](../../docs/PRACTICE_MAPPING_AUDIT.md), and
[runtime-aligned policy experiments](../../docs/ADAPTIVE_POLICY_RUNTIME_ALIGNMENT.md).
Saved-profile mapping is an optional mode of A and C, not a fourth evaluator.
