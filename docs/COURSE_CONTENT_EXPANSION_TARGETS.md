# Content expansion targets

Proposed 2026-09-07 at the user's request. This document plans a new, finite
content expansion; authoring has not started and no new goal has been created.
It follows the completed [content-readiness assessment](COURSE_CONTENT_FINAL_ASSESSMENT.md)
and existing [catalog conventions](GAME_CONTENT_CATALOGS.md).

## Scope commitment

Expand the learning catalogs for the currently enabled games using their
existing interactions. Preserve useful records, IDs, ordering where positional
identity matters, authored difficulty and saved progress. Verb Nebula receives
only bare verbs and their translations; no sentence or phrase exercises.

Permitted changes during a future execution:

- Learning records and their existing content fields: target and learner-base
  text, forms, contextual hints, explanations, pronunciation units, level,
  provenance and truthful review metadata.
- Existing shared English concepts and corresponding course realizations,
  including the Spanish learner-base catalog needed by Spanish-to-English.
- Derived catalog JSON and content-delivery hashes, byte sizes and cache
  revisions required by changed data, using the established generators.
- Batch review reports and content validation evidence under the established
  documentation and artifact directories.

Game JavaScript, adapters, CSS, HTML, database schemas, retrieval algorithms,
generator implementations, game capabilities, controls, stages, timing,
scoring, progress and scheduling are outside this expansion. Configuration
inside content JSON is also protected: editing `copy`, `gameplay`, `axes`,
`roundSettings` or similar fields would not become content work merely because
the file ends in `.json`.

Use the current formats and validators. If an entry requires an engine change,
choose a useful entry that fits the existing game. Report an unavoidable limit
without changing it. A discovered gameplay bug gets reported separately; this
plan does not authorize fixing or redesigning the game. Preserve concurrent
edits and report any protected-file difference rather than reverting it.

No new images are needed for these count targets. Existing embedding-distance
retrieval remains in place; sentence-to-image coverage is not a requirement.
Regenerate an existing declared content-derived index only if needed to deliver
the changed content, with its existing generator and format. No new database
architecture or image pipeline is part of this work.

Use canonical `C:\Work\caatuu` on `main` and the existing `caatuu-dev` container.
No APK build, deployment, release bump, branch, alternate checkout, delegation
or messages to other tasks. The old completed goal stays closed.

## Target matrix

Each cell is **Level 1 : Level 2 : Level 3**, counting records assigned to each
level rather than the cumulative playable pool. These are final bank sizes,
not the number of new records. A dash means that game is not currently enabled;
this plan does not enable it.

| Game / catalog | English → Czech | English → Mandarin | English → Spanish | Spanish → English | Total per applicable course |
| --- | --- | --- | --- | --- | ---: |
| Verb Nebula — playable verb pairs | 80 : 80 : 80 | 80 : 80 : 80 | 80 : 80 : 80 | 80 : 80 : 80 | 240 |
| Word World — sentences | 200 : 600 : 200 | 200 : 600 : 200 | 200 : 600 : 200 | 200 : 600 : 200 | 1,000 |
| Conjugation Comet — complete verb paradigms | 20 : 20 : 20 | — | 20 : 20 : 20 | 20 : 20 : 20 | 60 |
| Case Cosmos — playable contexts | 100 : 100 : 100 | — | — | — | 300 |
| Grammar Gravity — challenge families | 10 : 10 : 10 | — | 10 : 10 : 10 | 10 : 10 : 10 | 30 |
| Grammar Gravity — noun bank | 30 : 30 : 30 | — | 30 : 30 : 30 | 30 : 30 : 30 | 90 |
| Naturalization Nucleus — characters | — | 42 : 43 : 43 | — | — | 128 |
| Sound Quasar — words | 30 : 30 : 30 | 30 : 30 : 30 | 30 : 30 : 30 | 30 : 30 : 30 | 90 |
| Sound Quasar — sentences | 40 : 40 : 40 | 40 : 40 : 40 | 40 : 40 : 40 | 40 : 40 : 40 | 120 |

Campaign reuses the constituent games and has no additional bank.

The targets give the same record counts for the same enabled game across
courses; they do not pretend that a grammar family and a listening word
represent the same teaching volume. Every conjugation paradigm must include
its complete currently supported subject/form set. Every grammar family must
include the examples and distinct valid options required by its existing
language configuration. Supporting forms and examples are recorded separately
in the final inventory, never used to inflate the family count.

Word World's intermediate allocation preserves Czech's existing 565 level-2
sentences without deleting or relabeling them to balance a table. Its 1,000
target is substantial: the three modern courses each need 750 new sentences,
and Czech needs 208. This is the largest milestone, not a quick follow-up.

Naturalization Nucleus currently accepts at most 128 challenges. Its target
uses that existing capacity, adding eight characters to the current 120.
Grammar Gravity's 30 families remain below its current 48-family limit, and
Sound Quasar's 90 words and 120 sentences remain below its 500-item limit per
collection. The relevant bounds were read directly from the current validators.
None will be raised to achieve this plan.

Do not discard useful concurrent additions if a bank exceeds a proposed target
before execution. Capture the new baseline and record any resulting overage.
Do not relabel material, duplicate records or add unnatural examples merely to
make a count exact.

## Net additions from the verified baseline

These are new records needed, summed over the three levels. Units are those
named in each row; unlike units must not be presented as one exercise total.
The baseline is `artifacts/language-content-quality/final-content-readiness-20260907.json`;
its 33 source hashes still matched when this plan was prepared.

| Catalog | Czech | Mandarin | Spanish | English from Spanish |
| --- | ---: | ---: | ---: | ---: |
| Verb pairs | 90 | 60 | 60 | 194 |
| Word World sentences | 208 | 750 | 750 | 750 |
| Conjugation paradigms | 1 | — | 49 | 52 |
| Case contexts | 144 | — | — | — |
| Grammar families | 8 | — | 22 | 24 |
| Nouns | 54 | — | 50 | 50 |
| Nucleus characters | — | 8 | — | — |
| Listening words | 74 | 74 | 74 | 54 |
| Listening sentences | 104 | 104 | 104 | 39 |

## Finite execution milestones

1. **Capture the authorized baseline.** Record current catalog counts and hashes;
   protect gameplay source and configuration, the fixed rubric and existing
   records. Reuse current passing evidence where its hashes still match.
   Establish exact content and generated-output paths before the first batch.
2. **Complete the vocabulary banks.** Bring each Verb Nebula bank to 240 pairs
   and each enabled noun bank to 90 nouns. Fill the largest shortfalls first,
   notably English Verb Nebula, while assigning meaningful new L2/L3 content.
3. **Complete structured and listening banks.** Reach the conjugation, Case,
   Grammar, Nucleus and both listening targets. Follow existing language-specific
   teaching scope: no unsupported tense, category, stage or contextual-reading
   mode. Do not convert remaining old rubric objectives into engine work.
4. **Complete Word World and close.** Bring all four banks to 1,000 sentences.
   For the three modern courses, add shared concepts together with complete
   Mandarin, Spanish, English and required Spanish learner-base realizations.
   Czech follows its existing authoring/compiler route. Regenerate declared
   outputs, verify delivery, publish the final counts and end the pass.

Author and review in bounded batches, typically 20–50 words/sentences or up to
five paradigms/families. Each batch has exact IDs, level decisions, findings,
corrections and recheck results. Systematic errors expand review of the affected
batch, not the scope of the game. Updates summarize milestones and real
blockers; every small batch does not require a user message.

## Acceptance and stop condition

- Count only distinct, playable records in the existing runtime projection.
  New IDs must remain unique; retained records and progress references survive.
- Check translations, naturalness, agreement, contextual hints and valid
  distractors. Higher levels use genuinely more demanding material within the
  current interaction. Repeating a template with trivial substitutions is not
  sufficient evidence of useful breadth.
- Run the existing affected catalog and selector checks. Verify levels 1–3,
  declared modes, categories and offered board sizes remain usable. Do not weaken
  tests or raise runtime limits. If an old exact-count fixture needs a change,
  disclose the precise test-only adjustment before treating it as authorized.
- Use existing projection and offline generators; verify browser catalogs and
  Android source delivery match the authoring outputs. No APK is required.
- Compare the final diff against the permitted data paths and protected
  configuration. Report external shared changes separately; do not claim that
  this pass validated untested later game edits.
- Label AI self-review as self-review. Preserve native, licensing and audible
  review status truthfully. Actual listening review is reported separately from
  text validation; no unperformed review becomes a claim of approval.
- Finish when the agreed target banks are delivered and their content/data
  checks pass, with any unavoidable exception stated explicitly. Do not start
  extra expansion waves or invent a new completion criterion after that point.

These are content-volume and data-integrity targets. They do not award new
quality points or imply an 85 score. The
[frozen quality rubric](COURSE_CONTENT_QUALITY_BENCHMARK.md) remains unchanged;
its incompatible gameplay requirements are outside this expansion.
