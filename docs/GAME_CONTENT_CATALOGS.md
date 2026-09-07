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

## Word World: editable sources and loaded JSON

**Word World does use JSON during standard/authored play in every course.**
There are two stages: content authoring and runtime loading. The existence of a
build step does not mean the game invents its standard sentences or obtains
them from application code.

| Course | Authoritative editable content | What the app reads |
| --- | --- | --- |
| Czech | `tools/czech-ml/data/word-world/standard-v0.1/source/*.jsonl`, with existing editorial and token-hint JSON companions | The compiler writes `apps/languages/czech/static/data/games/word-world/content.json`; `manifest.json` identifies it and its integrity hash. |
| Mandarin, Spanish, English from Spanish | Shared English concept JSON plus each course's `content/word-world/starter-v1.realizations.json`; English from Spanish also uses the shared Spanish learner-base JSON | The projector writes each course's `static/data/games/word-world/content.json` and the required shared concepts, learner-base or reading-guide JSON. The runtime joins matching concept IDs. |

JSONL means one JSON object per line. It is editable structured content, not
executable code. The Czech compiler combines those records, applies recorded
editorial corrections, validates them, and writes the runtime JSON and manifest.
The modern projector validates aligned meanings/translations and emits the
JSON needed by the browser and Android source delivery. It can withhold
unreviewed pronunciation from the main runtime file while retaining the
separately labeled Mandarin preview guide.

For example, an English concept for asking the price, its Spanish sentence and
its token hints are joined by one stable concept ID. That lets the learner see
Spanish while the established retrieval system still uses the English meaning.
The generator does not author a new translation for the standard round.

Directly editing only the generated `content.json` is not the maintained
authoring route: the next generator run would overwrite it. Edit the source
catalogs, then run the existing generators and validation. That requires no
interface change. Dictionary lookup and image retrieval remain separate
supporting sources; Czech's existing optional generative mode is also separate
from its finite standard catalog and is not included in the catalog counts.

## Remaining Case Cosmos authoring coupling

The numeric bank ceilings were removed on 2026-09-07, but that alone does not
make every game freely extensible by JSON. Case Cosmos reads its exercises from
`content.json` and then compares them against checked content duplicated in
`case-cosmos-cs-policy.mjs`. Its `CHECKED_PARADIGMS` and `CHECKED_CONTEXTS` require
exact matches; legacy nouns/forms and sentence frames also have code-owned
allowlists. New IDs or new constructions can therefore be rejected even with
no numeric cap.

This corrects the earlier overbroad claim that all banks were ready for
JSON-only expansion. The checked linguistic data needs a separate move into
content authority, preserving its validation purpose, before Case's planned
expansion can be performed exclusively through content files. The cap-removal
work does not bypass, delete or weaken those checks and does not claim a valid
6,000-context Case bank has been tested.

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
