# Content expansion targets

Revised 2026-09-07 after the user rejected the original small targets and
explicitly authorized removing Naturalization Nucleus's catalog-size ceiling.
The user subsequently authorized removing the remaining catalog-size ceilings.
Those numeric ceilings are removed; the larger content banks below are proposed
targets, not completed authoring. No new goal has been created. Case's separate
code-owned checked-content allowlists remain an authoring blocker, recorded below.
It follows the completed [content-readiness assessment](COURSE_CONTENT_FINAL_ASSESSMENT.md)
and existing [catalog conventions](GAME_CONTENT_CATALOGS.md).

## Learning purpose and scale

The earlier 240-verb / 1,000-sentence proposal was an incremental expansion,
not an adequate plan for a broad course. This revision targets sustained study:
thousands of useful lexical items and varied examples across everyday life,
travel, services, relationships, study, work, explanations and opinions.

The intended direction is independent language use. The
[Council of Europe's CEFR global scale](https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale)
describes B1/B2 through comprehension, communication and production abilities.
It does not prescribe the record counts in this plan. These quantities are
editorial planning targets, not evidence of a CEFR level or a promise that
finishing matching games establishes conversational proficiency.

L1 covers frequent concrete language and simple everyday functions; L2 adds
broader routines, descriptions, transactions and connected events; L3 adds
precision, abstraction, nuanced meanings and more demanding constructions where
the current game supports them. The application's three levels are not being
renamed or certified as CEFR levels. Required learning outcomes that cannot be
practised or assessed by an existing interaction remain documented gaps.

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

The explicit capacity exceptions now cover Nucleus, both Sounds collections,
Case's legacy nouns/checked paradigms/authored contexts, and Grammar's family
bank. Focused tests and course cache/integrity metadata accompany those changes.
Minimum viable bank sizes, item validation, round sizes, stage definitions and
linguistic checks remain intact. This does not authorize unrelated game changes
or removal of checks on correctness and reviewed content.

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
| Verb Nebula — playable verb pairs | 400 : 600 : 800 | 400 : 600 : 800 | 400 : 600 : 800 | 400 : 600 : 800 | 1,800 |
| Word World — sentences | 5,000 : 15,000 : 5,000 | 5,000 : 15,000 : 5,000 | 5,000 : 15,000 : 5,000 | 5,000 : 15,000 : 5,000 | 25,000 |
| Conjugation Comet — complete verb paradigms | 100 : 200 : 300 | — | 100 : 200 : 300 | 100 : 200 : 300 | 600 |
| Case Cosmos — playable contexts | 1,000 : 2,000 : 3,000 | — | — | — | 6,000 |
| Grammar Gravity — challenge families | 16 : 16 : 16 | — | 16 : 16 : 16 | 16 : 16 : 16 | 48 |
| Grammar Gravity — bilingual examples within those families | 1,000 : 2,000 : 3,000 | — | 1,000 : 2,000 : 3,000 | 1,000 : 2,000 : 3,000 | 6,000 |
| Grammar Gravity — noun bank | 500 : 1,000 : 1,500 | — | 500 : 1,000 : 1,500 | 500 : 1,000 : 1,500 | 3,000 |
| Naturalization Nucleus — characters | — | 500 : 1,000 : 1,500 | — | — | 3,000 |
| Sound Quasar — words | 500 : 1,000 : 1,500 | 500 : 1,000 : 1,500 | 500 : 1,000 : 1,500 | 500 : 1,000 : 1,500 | 3,000 |
| Sound Quasar — sentences | 1,000 : 2,000 : 3,000 | 1,000 : 2,000 : 3,000 | 1,000 : 2,000 : 3,000 | 1,000 : 2,000 : 3,000 | 6,000 |

Campaign reuses the constituent games and has no additional bank.

The targets give the same record counts for the same enabled game across
courses; they do not pretend that a grammar family and a listening word
represent the same teaching volume. Every conjugation paradigm must include
its complete currently supported subject/form set. Every grammar family must
include the examples and distinct valid options required by its existing
language configuration. Supporting forms and examples are recorded separately
in the final inventory, never used to inflate the family count. Grammar's
larger target is primarily example depth within useful families. The 6,000
examples and 48 families are nested counts, not 6,048 independent exercises.
Do not invent redundant grammar families to reach the proposed family target.

Word World's intermediate allocation preserves existing material and satisfies
the Czech author's existing 60% minimum L2 distribution rule. It is not a claim
that every language should universally allocate 60% of study to intermediate
content. Each of the three modern courses needs 24,750 new sentences and Czech
needs 24,208. Existing shared concept IDs keep their meaning; new concepts must
have complete course and learner-base realizations. Czech's current authoring
files are JSONL plus supporting JSON, compiled by the existing generator.

## Capacity readiness before the large expansion

| Boundary | Current state | Consequence for these targets |
| --- | --- | --- |
| Nucleus catalog count | User-authorized upper ceiling removed; minimum and item validation retained | A synthetic 4,096-record bank validates and produces the existing 5/9-piece rounds at every difficulty. This is capacity evidence, not authored curriculum or an unlimited-memory claim. |
| Sound Quasar collections | Upper count ceilings removed for both collections; minimum four entries and all item checks retained | Synthetic 6,000-record collections test the existing modes, difficulty filtering and choice rules. These are fixtures, not curriculum or device performance evidence. |
| Case Cosmos | Numeric ceilings removed for legacy nouns, checked paradigms and authored contexts | Separate code-owned exact checked-content allowlists still block new content. Oversized invalid fixtures prove the remaining correctness/duplicate checks still reject them; they do not establish acceptance of a new large Case bank. |
| Grammar Gravity | Family-count ceiling removed; minimum four families and form/example checks retained | A synthetic 256-family bank tests example reachability at every difficulty. The planned 48 useful families remain an editorial target, not a runtime restriction. |
| Other banks and delivery | The small existing banks validate; the proposed larger catalogs are not yet authored or tested | Check new sizes, all-record reachability, loading and offline/Android source delivery at each milestone. Do not claim full-scale readiness based on the old inventory. |

The remaining identified obstacle to JSON-only authoring is Case's checked
content duplicated in JavaScript, not Word World's generated runtime JSON.
See [the source-of-content explanation](GAME_CONTENT_CATALOGS.md). Move that
checked linguistic authority to content data in a separately scoped preparation
step before Case expansion; do not bypass the checks. Other full-size banks
still need normal loading, selection and delivery validation as they are authored.

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
| Verb pairs | 1,650 | 1,620 | 1,620 | 1,754 |
| Word World sentences | 24,208 | 24,750 | 24,750 | 24,750 |
| Conjugation paradigms | 541 | — | 589 | 592 |
| Case contexts | 5,844 | — | — | — |
| Grammar families (up to) | 26 | — | 40 | 42 |
| Grammar examples (within families) | 5,812 | — | 5,936 | 5,976 |
| Nouns | 2,964 | — | 2,960 | 2,960 |
| Nucleus characters | — | 2,880 | — | — |
| Listening words | 2,984 | 2,984 | 2,984 | 2,964 |
| Listening sentences | 5,984 | 5,984 | 5,984 | 5,919 |

## Finite execution milestones

1. **Capture the authorized baseline.** Record current catalog counts and hashes;
   protect gameplay source and configuration, the fixed rubric and existing
   records. Reuse current passing evidence where its hashes still match.
   Establish exact content and generated-output paths before the first batch,
   map communicative functions and language-specific contrasts to the existing
   interactions, and resolve the separately recorded Case authoring coupling.
2. **Complete the vocabulary banks.** Bring each Verb Nebula bank to 1,800 pairs
   and each enabled noun bank to 3,000 nouns. Work through all three levels and
   frequent practical domains; uncommon filler does not make a course stronger.
3. **Complete structured and listening banks.** Reach the conjugation, Case,
   Grammar, Nucleus and both listening targets. Follow existing language-specific
   teaching scope: no unsupported tense, category, stage or contextual-reading
   mode. Complete only supported banks until Case's checked-content authority
   is moved without weakening its checks. Do not convert remaining old rubric
   objectives into engine work.
4. **Complete Word World and close.** Bring all four banks to 25,000 sentences.
   For the three modern courses, add shared concepts together with complete
   Mandarin, Spanish, English and required Spanish learner-base realizations.
   Czech follows its existing authoring/compiler route. Regenerate declared
   outputs, verify delivery, publish the final counts and end the pass.

This is a multi-milestone curriculum project, not a one-turn generation job.
Review and hand off useful increments at roughly 25%, 50%, 75% and 100% of
each bank target, without counting a partial handoff as completion. Fix the
targets at execution start and do not keep expanding them during that goal.

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
  tests or raise another runtime limit implicitly. Tests with live-bank counts
  must validate the actual catalog declarations and meaningful invariants,
  rather than freeze today's 120 characters or 40/40/40 split. Scope any needed
  test-only adjustment to the changed data; do not relax language/review checks.
- Use existing projection and offline generators; verify browser catalogs and
  Android source delivery match the authoring outputs. No APK is required.
- Compare the final diff against the permitted data paths and protected
  configuration. Report external shared changes separately; do not claim that
  this pass validated untested later game edits.
- Label AI self-review as self-review. Preserve native, licensing and audible
  review status truthfully. Actual listening review is reported separately from
  text validation; no unperformed review becomes a claim of approval.
- Maintain a coverage ledger by communicative function, grammar contrast,
  domain and lexical sense, with naturally different constructions and contexts.
  Revisit important words and constructions across multiple situations and
  levels instead of treating a single encounter as learning. Track near-duplicate
  templates as well as exact text duplicates. Count individual senses honestly;
  don't manufacture several indistinguishable verb cards to inflate totals.
- Use held-out examples for an editorial assessment of generalization and
  record what the current games actually assess. Do not implement new transfer
  locks, speaking tasks or progression controls under this content authorization.
- Finish when the agreed target banks are delivered and their content/data
  checks pass, with any unavoidable exception stated explicitly. Do not start
  extra expansion waves or invent a new completion criterion after that point.

These are content-volume and data-integrity targets. They do not award new
quality points or imply an 85 score. The
[frozen quality rubric](COURSE_CONTENT_QUALITY_BENCHMARK.md) remains unchanged;
its incompatible gameplay requirements are outside this expansion.
