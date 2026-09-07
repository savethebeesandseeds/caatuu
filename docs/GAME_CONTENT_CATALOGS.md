# Game content catalogs

Runtime filename convention, adopted 2026-09-07:

```text
apps/languages/<course>/static/data/games/<game>/
  content.json       Main learning content
  manifest.json      Word World loader and projection metadata
  nouns.json         Grammar Gravity standalone noun bank
  reading-guides.json  Mandarin Word World pronunciation guides
  learner-base.json    Spanish prompts for the English course
```

Only the files applicable to a game exist. Campaign reuses other games and has
no independent content bank. Word World continues to join its shared English
concept authority with course realizations. Its versioned authoring inputs
remain separate from runtime output. Content IDs, corpus versions, translations,
review status and licensing status survive filename changes.

Course manifests own the paths. Generators, browser profiles, offline manifests,
Android source asset mappings, dictionary references and maintained tests use
those declarations. The filename contract is checked by
[game-content-filenames.test.mjs](../tools/language-packs/tests/game-content-filenames.test.mjs).

## Difficulty behavior

- Verb Nebula, Word World, Conjugation Comet, Case Cosmos, Grammar Gravity
  phrases and Naturalization Nucleus retain their existing selection behavior.
- Sounds Quasar now preserves valid item difficulty and limits both answers and
  distractors to the chosen level and earlier levels. Words/sentences remain a
  manual choice. A smaller eligible pool reduces answer choices rather than
  borrowing harder content. Invalid levels are rejected.
- Standalone noun practice accepts and preserves optional difficulty. Each new
  noun cycle uses the selected course level; an in-progress cycle completes
  normally. The 40 English nouns recover their existing authored levels from
  the preserved pilot, with exact ID, text, translation and classification checks.
- Ungraded legacy items remain supported for compatibility. The subsequent
  [retained-content grading pass](COURSE_CONTENT_RETAINED_REVIEW.md) assigned
  editorial levels to the remaining 231 current items. The inventory reports
  any future ungraded rows explicitly rather than calling defaults authored grades.

No learning text, answers, scoring, fall speed, game stages or manual mode
controls were changed by this repair. Content expansion remains separate from
filename repair and retained-bank grading.

Run the current inventory in the established container:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/quality/inventory.mjs
```

## Verification and recovery

All 22 renamed JSON files were compared in full with the pre-migration recovery
snapshot, allowing only normalized file references. All 40 English nouns were
compared in full, allowing only restored difficulty and the catalog revision.
All 29 live catalog/manifest URLs across the four courses were checked against
their canonical source bytes. The browser loaded the repaired listening game
with its existing controls and unchanged rewards.

Recovery snapshots are under
`artifacts/recovery/before-catalog-normalization-2026-09-07T17-12-45-268Z/`
and `artifacts/recovery/before-difficulty-selection-20260907/`.
Focused game, course-contract and Android source-delivery test logs are under
`artifacts/recovery/catalog-*-tests.log`. No APK build or deployment was performed.
