# Course content quality improvement plan

**Execution update, 2026-09-07:** follow the
[current content-only execution plan](COURSE_CONTENT_EXECUTION_PLAN.md).
The proposals below are retained as planning history. They do not authorize
gameplay changes or override the user's subsequent scope corrections.

Planning baseline: 2026-09-07. Status: active persistent goal, authorized on
2026-09-07. Follow the [frozen benchmark](COURSE_CONTENT_QUALITY_BENCHMARK.md)
and [checkpoint log](COURSE_CONTENT_QUALITY_PROGRESS.md) for execution evidence.

## Objective and scope

**Controlling user correction, 2026-09-07:** this is content work. Preserve the
existing games, stages, round order, saved-board behavior, scoring and timing.
Do not add progression engines, transfer locks, automatic mode selection or
new interaction stages to satisfy this plan. Earlier implementation proposals
below that imply those changes are superseded. Keep the fixed rubric unchanged;
report any score requirement that content alone cannot meet as unresolved.
The immediate authorized checkpoint is the selective repair documented in
[gameplay recovery](COURSE_CONTENT_GAMEPLAY_RECOVERY.md).

Improve every currently enabled course/game pair to at least 85/100 under the
fixed content rubric below, with reviewed source changes, working progression,
and evidence for each score. The target is a coherent practice curriculum across
the existing three difficulty levels. This is not a measured learner proficiency
percentage or a claim of complete language coverage.

User correction, 2026-09-07: Verb Nebula must remain simple verb-to-translation
matching. Do not display sentence prompts, phrase exercises, sentence examples
or optional sentence help in this game. Improve its verb inventory, translations,
level selection and recall within that interaction. The abandoned sentence pilot
does not earn breadth or transfer credit. Rubric weights and score floors remain
unchanged; unresolved verb-only evaluation gates remain open.

The scope is four directional courses and 20 independent course/game pairs.
Campaign contributes four additional derived scores because it reuses content.
Use the [course catalog](../apps/languages/catalog.json) and
[shared game policy](../apps/language-runtime/static/source/shell-policy.js)
to enumerate the actual playable combinations. Disabled games, including Memory
Moon, are outside this plan; no language should acquire an irrelevant game merely
to fill a matrix cell.

Delivery includes authored catalogs, data compatibility fixes for existing games,
tests, generated browser/Android asset projections, review records and a final
quality matrix. No APK build, release version bump, deployment, new game, model
training or wholesale application redesign is included.

## Baseline

These are the initial editorial estimates, rounded to five points. They came
from catalog inspection, representative samples, recorded reviews and existing
test definitions, not a complete independent language examination.

| Game | English to Czech | English to Mandarin | English to Spanish | Spanish to English |
| --- | ---: | ---: | ---: | ---: |
| Verb Nebula | 75 | 70 | 70 | 60 |
| Word World | 80 | 75 | 70 | 80 |
| Conjugation Comet | 75 | - | 70 | 65 |
| Case Cosmos | 70 | - | - | - |
| Grammar Gravity | 65 | - | 75 | 75 |
| Naturalization Nucleus | - | 65 | - | - |
| Sounds Quasar | 50 | 55 | 50 | 55 |
| Campaign, derived | 75 | 75 | 70 | 70 |

The [Spanish-to-English review](../apps/languages/english-from-spanish/content/REVIEW.md)
provides an existing example of item-level corrections, actual bank sizes and
selection limitations. Preserve its historical claims rather than rewriting
them as evidence of work performed in this goal.

## Quality contract

Keep the original weights. Before authoring, record each game's learning
objectives, expected coverage, review questions and representative evaluation
cases. New counts or a passing schema check cannot by themselves earn a score.

| Dimension | Weight | Evidence required for a strong score |
| --- | ---: | --- |
| Correctness and naturalness | 40 | Correct answers, translations, contextual hints, accepted variants and explanations; language-specific uncertainties resolved or explicitly retained as defects. |
| Breadth and variation | 25 | Coverage of the declared objectives using varied contexts and vocabulary; distinct teaching contrasts rather than many copies of one sentence template. |
| Progression and pedagogy | 25 | Each level introduces meaningful objectives; practice, separated review and unfamiliar transfer examples are available and actually selected by the runtime. |
| Verification and review evidence | 10 | Traceable editorial reviews, correction logs, focused content/runtime checks and observed delivery behavior; audio evidence when listening content is scored. |

Each independent pair must score at least 85 before rounding. Additionally,
correctness must reach at least 35/40, breadth and pedagogy at least 20/25 each,
and evidence at least 8/10. A strong course cannot compensate for a weak game.
Campaign's score is its eligible games' mean; it cannot conceal a deficient bank.

All of these gates also apply:

- No known unresolved wrong answer, misleading instructional translation,
  incorrect grammatical explanation or ambiguous distractor/answer pair.
- Every declared objective has several lexical contexts and a transfer example
  excluded from introductory practice. Fix evaluation defects openly; do not
  silently lower objectives, remove difficult cases or adjust the scoring weights.
- Level selection changes the taught material and demand, with purposeful review
  of earlier material. XP or faster falling objects alone is not progression.
- All new or changed answers, translations and hints receive a separate editorial
  pass. Audit retained content across every level, objective and known risk area;
  expand review when a sample exposes a systematic defect.
- The reviewer records item IDs, findings and rechecks. Separate agents may author
  and review material; their review remains AI editorial review. Never relabel it
  as native-speaker or independent human approval, or invent license clearance.
- Content identity, concept joins, token positions, acceptable variants and
  browser/Android delivery remain valid. Automated checks establish these
  properties; linguistic quality still requires editorial judgment.

The final score remains an evidence-backed editorial assessment. It does not
establish measured learning gains. A native-speaker spot check can increase
confidence, but hiring a teacher is not a prerequisite for starting or delivering
the software/content work.

## Work by game

| Game | Required improvement | Initial planning size, subject to objective coverage |
| --- | --- | --- |
| Verb Nebula | Keep cards and spoken prompts limited to verbs and their translations. Improve translation accuracy, useful verb coverage, meaningful tiers and separated recall; preserve genuine verb distinctions without sentence exercises or sentence help. | Keep and improve the existing 150 Czech and 180 Spanish/Mandarin playable pairs where useful. Expand English's 16 pairs toward a reviewed 80-120-item bank first; increase further if the objective map is incomplete. |
| Word World | Correct literal idiom/function-word hints, rebalance overly language-specific starter themes, and organize contexts around taught objectives with deliberate vocabulary/grammar recycling. Add transfer examples and strengthen sparse upper-level coverage. | Improve the existing 792 Czech sentences and 250 sentences per modern course before mass expansion. Add only the sentences needed by the objective/variation map; preserve existing stable IDs. |
| Conjugation Comet | Expand the 11 Spanish and eight English paradigms; grade Czech's 59. Teach useful tense/aspect/person contrasts with clear cues, irregular patterns, negatives/questions where relevant, and unseen verbs using learned patterns. | Author reviewed blocks per grammatical pattern, not a target total of repeated person forms. Existing records support 2-12 forms; add small shared selection/cue support only where required. |
| Case Cosmos | Extend Czech beyond the 17 people/names and one kitten. Cover inanimate nouns, plural forms and common preposition/role contrasts; handle identical forms without false distractors. | Pilot 20-30 new contexts, then roughly 150-250 additional contexts across the coverage map. Do not force unnatural examples into every theoretical case combination. |
| Grammar Gravity | Extend Czech beyond singular hard-adjective gender. Improve Spanish gender/number, exceptions and level order. Expand English number, determiners, auxiliaries and agreement in varied contexts. Give noun practice authored difficulty and transfer items. | Pilot each new grammatical family with multiple anchors; Czech likely needs 20-30 additional families. Expand the small English phrase/noun bank by objective rather than template multiplication. |
| Naturalization Nucleus | Strengthen Mandarin's 120-character inventory with contextual readings, tone contrasts and meaningful difficulty. Distinguish citation forms from contextual changes and preserve pinyin/reading-unit correctness. | Start by improving the existing inventory. Add characters/readings needed for common-word and tone coverage rather than maximizing the number of isolated characters. |
| Sounds Quasar | Replace the 16-word/16-sentence pilot with graded sound/meaning contrasts, stress/tone targets and connected speech. Add reviewed distractor groups, difficulty and contextual listening. | Pilot each course, then aim initially for 60-80 words/expressions and 100-160 sentences per course. The current validator caps banks at 80 words and 240 sentences; increase limits only if justified by the curriculum and tested. |

These sizes are workload estimates, not an automatic route to 85. Review a small
representative pilot before expanding any bank.

## Shared-runtime work

Extend the current shared game engines; keep course-specific content in the
course packs. Inventory supported schemas before making a migration.

1. Add authored difficulty filtering to Sounds Quasar and standalone noun
   practice, preserving saved progress and existing course behavior.
2. Support reviewed distractor/contrast groups in listening so a right answer
   cannot be identified from obviously unrelated choices.
3. Ensure new objectives, contextual cues and transfer examples are exposed by
   the real game loaders, not merely stored in unused JSON fields.
4. Add bounded review selection using existing exposure/error history where
   needed. Demonstrate successful recall on separated rounds and unfamiliar
   examples; a new learning model or a full adaptive-learning platform is not
   required for this scope.
5. Use the existing concept/target/learner-base separation for Word World.
   One integration owner manages shared English concepts and shared Spanish
   learner-base material; course authors own their target realizations. Keep
   English audit/retrieval authority and all runtime projection bindings intact.

## Checkpoints and execution

| Checkpoint | Deliverable | Exit evidence |
| --- | --- | --- |
| 1. Freeze the benchmark | Per-pair objective map, baseline inventory, defect list, scoring anchors and evaluation cases. | All 20 independent pairs covered; actual runtime projections counted; scope and rubric recorded. |
| 2. Prove the improvement loop | A representative English vocabulary/listening pilot and Czech grammar/case pilot, including any shared-runtime changes. | Separate editorial review, usable level/transfer behavior, focused tests and source/browser inspection. Use observed throughput to estimate remaining work. |
| 3. Complete content waves | Shared progression support, then English/listening gaps, remaining conjugation/grammar/case work, Word World and Mandarin refinements. | Each batch has reviewed authored content, correct generated projections and an updated issue/evidence record before the next batch. |
| 4. Verify integration | Browser games at the existing three levels, Android JS asset compilation and complete offline delivery. | Catalog/content/runtime checks pass; every declared playable pair loads the intended final content. No Gradle or APK build. |
| 5. Reassess and close | Final 20-pair scorecard, four derived Campaign scores, review findings and exact remaining limitations. | Every pair meets the unrounded 85 threshold and component floors; no unresolved correctness or delivery gate. |

Use short batches, normally 25-50 new learning items or a few grammar families.
Parallelize language-specific authoring and separate review, with one owner for
shared schema/runtime changes and integration. Persist checkpoint state and
evidence so another turn can resume without repeating the complete audit.

This is a substantial content and runtime project across 20 pairs. A reliable
time/token estimate needs the pilot's authoring, review and correction rate.
Do not promise a fixed number of hours or a single uninterrupted run. If a user
sets a budget, prioritize checkpoints and report unfinished work truthfully.

## Validation and listening evidence

Run generators and Node checks inside the existing `caatuu-dev` container with
the canonical checkout at `/workspace`. Use the focused checks documented in
[language packs](../tools/language-packs/README.md),
[language content](../tools/language-content/README.md) and each changed game.
Synchronize generated course views and refresh setup hashes after their inputs
are final. Verify Android course assets with the existing Node asset pipeline;
do not build an APK merely to validate authored material.

Listening needs an audible review of representative words, sentences and
contrast sets on identified browser/Android speech configurations. Record the
voice, locale, device/runtime and observed defects. A successful TTS call or
correct input JSON is not proof of intelligible, correctly pronounced output.
Use an accessible existing device/runtime where possible. If it cannot be heard
or accessed, finish independent text/runtime work and explicitly retain the
audio verification gap; do not claim a fully verified Sounds score of 85.
Unpredictable on-demand generated sentences similarly cannot inherit the
authored corpus's quality score without separate evaluation.

## Workspace and goal boundaries

- Work only in canonical `C:\Work\caatuu` on `main`, following repository
  branch/ref and container-mount checks. Preserve concurrent changes and
  coordinate ownership before overlapping edits or release operations.
- No branches, worktrees, alternate previews, host dependency installations,
  APK builds or deployment are authorized by this plan.
- Implementation can proceed autonomously within this scope once the user
  explicitly starts the goal. Ask only for missing access, a real ownership
  conflict or a material scope decision; do not ask permission for each batch.
- Keep milestone updates concise. Complete means the evidence supports the
  acceptance criteria, not that files were generated or the budget ran out.

Suggested goal instruction:

> Execute docs/COURSE_CONTENT_QUALITY_PLAN.md. Improve all 20 currently enabled
> course/game pairs to at least 85/100 under its fixed rubric and acceptance
> gates. Implement the necessary authored-content and shared-runtime changes,
> review them separately, validate browser and Android assets in the established
> container, and deliver the final evidence-backed matrix. Work only on canonical
> main, preserve other sessions' changes, and do not build an APK or deploy.
> Keep progress updates concise and report any unverified language/audio limits
> honestly instead of marking them complete.
