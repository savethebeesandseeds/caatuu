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
no independent content bank. Word World has one editable JSON per course and
generates the existing runtime and publication formats from it. Content IDs,
corpus versions, translations,
review status and licensing status survive filename changes.

Course manifests own the paths. Generators, browser profiles, offline manifests,
Android source asset mappings, dictionary references and maintained tests use
those declarations. The filename contract is checked by
[game-content-filenames.test.mjs](../tools/language-packs/tests/game-content-filenames.test.mjs).

## Word World: one editable JSON per course

All five courses use `caatuu-word-world-course-content-v1`, with one complete
record per sentence. Edit only the corresponding authoring file:

| Course | Editable file | Records at migration |
| --- | --- | ---: |
| English → Czech | [content.json](../apps/languages/czech/content/word-world/content.json) | 792 |
| English → Mandarin | [content.json](../apps/languages/mandarin-simplified/content/word-world/content.json) | 250 |
| English → Spanish | [content.json](../apps/languages/spanish/content/word-world/content.json) | 250 |
| Spanish → English | [content.json](../apps/languages/english-from-spanish/content/word-world/content.json) | 250 |
| English → Norwegian Bokmål | [content.json](../apps/languages/norwegian-bokmal/content/word-world/content.json) | New course; see its [onboarding report](NORWEGIAN_BOKMAL_COURSE_20260909.md) |

Each record holds its stable `id`, `difficulty`, `topic`, `englishText`,
`embeddingText`, `targetText`, `tokens`, pronunciation, scene query and any
learner-base translation. `englishAlternates`, `sceneAssetIds` and `annotations`
retain existing Czech information; unsupported fields remain empty on providers
that do not use them. Czech annotations preserve CEFR, learning objectives,
grammar, provenance and review. Catalog metadata preserves review and licensing
for English, target and learner-base roles. The format does not invent human
review or promote any development course.

`learnerBase` is null for English-base courses because `englishText` already
supplies that translation. Spanish → English records include Spanish text and
position-bound Spanish word hints there. Czech token hints are now inline in
`tokens[].gloss`; historical editorial corrections have already been applied.
The Czech provider uses its included English sentence for semantic ranking;
its `embeddingText` must equal `englishText`. Modern courses retain their
separately authored English retrieval descriptions. Image retrieval and the
optional Czech generative mode are unchanged.

Run the same build command for any course, in the established container:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/build-word-world-content.mjs --all
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses
docker exec -w /workspace caatuu-dev node tools/language-content/build-word-world-content.mjs --all --check
```

Use `--course cz`, `zh`, `es`, `es-en`, or `nb` instead of `--all` to build one course.
The builder validates before writing, preserves the existing game formats,
refreshes changed course cache markers, and maintains Czech's content-addressed
offline URL. Setup refresh updates existing integrity metadata. No APK build or
deployment is involved.

The older `starter-v1.realizations.json`, shared concept catalogs and Spanish
learner-base catalog are **generated compatibility views** for existing
publication tools. The runtime `static/data/games/word-world/content.json` files,
reading guide, manifest and learner-base file are generated too. Do not edit
those outputs: the next build recreates them from the five authoring files.
The old Czech JSONL batches, correction ledgers and review receipts are retained
as historical evidence and are not inputs to normal builds. Existing Czech
build/validation commands and the modern projector CLI now read the new files;
explicit legacy-input tools remain available for historical import tests.

Each modern course has its own generated English projection, so adding a new
record to Spanish does not require adding it to Mandarin or English. Reusing
an existing concept ID preserves its English meaning across courses; inventories
and difficulty may differ. New content still needs linguistic review. The
builder's structural checks and unchanged fixed rubric are not that review.

## Case Cosmos: JSON is the content authority

Following the numeric ceiling removal, the user separately authorized removal
of the code-owned acceptance lists on 2026-09-07. All duplicate noun/form lists,
sentence templates and exact context/paradigm copies were removed from
`case-cosmos-cs-policy.mjs`; that file now only checks the course language pair.
New vocabulary, IDs, translations and contexts can be supplied directly in
the existing `content.json`, without changing JavaScript or pinning new text
in tests.

Runtime checks retain the data contract, required levels, unique IDs and
sentences, whole-word targets, declared form pools, accepted alternatives,
solvable choices and curriculum references/coverage. They cannot certify Czech
grammar or translation accuracy; that belongs to content review. Tests now
exercise these boundaries and JSON-only additions instead of enforcing a
second copy of the curriculum. Synthetic fixtures validate 501 legacy nouns,
201 additional paradigms and 6,000 additional contexts. These are capacity
fixtures, not new teaching content or device-performance certification.

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
