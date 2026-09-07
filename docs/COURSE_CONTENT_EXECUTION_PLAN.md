# Course content execution plan

Authorized 2026-09-07 after catalog normalization. This is the current execution
plan for all four courses and 20 independent course/game pairs. It supersedes
implementation proposals in the [original plan](COURSE_CONTENT_QUALITY_PLAN.md).
The [frozen benchmark](COURSE_CONTENT_QUALITY_BENCHMARK.md), its initial scores,
weights, component floors and objective map remain unchanged.

**Pass closed 2026-09-07.** The user explicitly asked for a finite conclusion
after the completed milestones. The [final assessment](COURSE_CONTENT_FINAL_ASSESSMENT.md)
records all 20 pairs, delivered improvements, validation and unmet gates. No
further expansion wave is implicitly authorized by this plan. Closing the
content-readiness pass does not certify the separate 85 target.

## Boundaries

Improve existing catalogs before adding material. Preserve useful entries and
stable IDs. Keep the established games, stages, manual modes, scoring, timing,
saved progress and artwork behavior. Verb Nebula contains verbs and translations
only, including speech and post-answer presentation. Do not add sentence help,
progression engines, review schedulers, transfer locks or new game interactions.

Artwork is a nearest-neighbor semantic association, not a literal illustration
for every sentence. Preserve embedding-distance ranking. A missing exact image
is not a content defect and does not require new artwork or a forced mapping.
Register finished images in `apps/launcher/static/assets/visual-vocabulary/`.

Work in canonical `C:\Work\caatuu` on `main` using the existing `caatuu-dev`
container. Preserve shared changes. No APK build, deployment, release version
change, new branch, alternate checkout, service or messages to other tasks.

## Checkpoints

| Step | Work | Completion evidence |
| --- | --- | --- |
| 1. Protect and measure | Snapshot catalog inputs and hash existing game implementation; capture current inventory. Exercise every enabled course/game at levels 1, 2 and 3, including listening modes and noun practice. | Repeatable checks use real catalog declarations and runtime selectors; eligible pools, answers, distractors and supported board sizes remain playable. Empty or insufficient pools fail before content handoff. |
| 2. Grade retained banks | Assign editorial levels to the 59 ungraded Czech conjugation paradigms, 36 Czech nouns, 40 Spanish nouns and 96 Czech/Mandarin/Spanish listening items. Review each affected row and retain its source/review metadata. | Exact item-level grading decisions and reasons; no invented upper-level material or claim of CEFR calibration; all existing IDs preserved and all rows reachable. Re-run step 1 after each batch. |
| 3. Correct existing content | Review translations, forms, contextual token hints, ambiguity and distractors across every level and objective. Start with evidenced Word World contextual-hint defects. Keep image descriptions faithful to the artwork and register approved assets in the shared catalog. Audit actual listening output when accessible. | Corrections cite item IDs and evidence; systematic defects expand the relevant review. Text review, audible review, image description accuracy and independent review have separate statuses. Missing evidence stays open; literal image coverage is not required. |
| 4. Improve coverage | After the affected bank passes its data checks and known corrections, add small batches for missing objectives that fit its existing interaction. Review each batch before continuing. | Preserved entries plus traceable additions; exact counts and meaningful levels; no sentences in Verb Nebula, no gameplay changes. A second pass by the same author is labeled self-review, never independent approval. |
| 5. Verify delivery and reassess | Update declared projections and cache hashes when their inputs change. Check browser/offline and Android source assets without an APK. Reassess every pair against the unchanged benchmark. | Canonical source and delivered catalogs agree, focused checks pass, a final matrix records evidence and unmet gates without inflated scores. Campaign remains derived from its constituent games. |

## Scoring conflict and completion

The frozen pedagogy/evaluation gates require practice-triggered transfer locks
and separated scheduled review. Those mechanisms are outside the authorized
content-only scope. Some verb objectives also require contextual assessment that
the user has explicitly excluded from Verb Nebula. Record those gates as unmet;
do not change the games, silently replace the criteria or claim unused metadata
satisfies them. The target remains 85 with all component floors, but completion
of content edits does not establish that target.

Audio requires listening to the identified voice and locale. Speech API success
does not count. Missing audible/device access does not stop independent text and
data work. Native review and licensing status are preserved, never inferred.

## Evidence and working commands

Use [catalog conventions](GAME_CONTENT_CATALOGS.md) for runtime filenames and
authoring authorities. Keep dated inventories, recovery copies and detailed
machine output under `artifacts/language-content-quality/`; record decisions and
checkpoint status in [the progress log](COURSE_CONTENT_QUALITY_PROGRESS.md).

Run content tooling and focused Node checks in the established container:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/quality/inventory.mjs
docker exec -w /workspace caatuu-dev node --test tools/language-content/quality/game-readiness.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --all
docker exec -w /workspace caatuu-dev node tools/language-content/project-word-world-runtime.mjs --all --check
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
docker exec -w /workspace caatuu-dev node --test apps/server/tooling/tests/word-net-standard.test.mjs
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check
```

Run the affected game and Android source-delivery contracts after final inputs
are stable. Do not rerun broad checks without a new change, failure or unresolved
concern. Keep updates to findings and completed checkpoints.
