# Retained content grading review

Date: 2026-09-07. Part of the [execution plan](COURSE_CONTENT_EXECUTION_PLAN.md).
Author: Codex. Evidence is an AI author review and a separate self-check of the
resulting data. It is not independent editorial or native-speaker approval.
Original review, licensing and pronunciation metadata is preserved.

## Batch 1: 231 previously ungraded items

The author inspected the target, meaning, existing noun category, and all six
forms/cues of every affected Czech conjugation paradigm. This batch adds only
editorial difficulty and changes the affected catalog revisions. It does not
change learning text, IDs, forms, answers, game implementation or images.

Counts below are assigned levels, not cumulative selectable pools. Existing
selectors include earlier levels. These are curriculum ordering decisions for
the game's levels, not CEFR classification or measured learner performance.

| Catalog | Level 1 | Level 2 | Level 3 | Ordering rationale |
| --- | ---: | ---: | ---: | --- |
| Czech conjugation paradigms | 20 | 20 | 19 | Common present patterns and essential irregulars; additional motion/reflexive/modal and stem contrasts; perfective forms with future cues. Past paradigms remain missing. |
| Czech standalone nouns | 18 | 12 | 6 | Common singular gender patterns; wider vocabulary and feminine -e; neuter -e/-í versus feminine consonant/-ie endings. Existing authored gender is authoritative. |
| Spanish standalone nouns | 20 | 14 | 6 | Regular -o/-a vocabulary; mixed -e/consonant endings and broader vocabulary; masculine -a/feminine -o exceptions. |
| Czech listening words | 12 | 4 | 0 | Common short responses, then longer forms with additional syllables and consonant sequences. |
| Czech listening sentences | 6 | 10 | 0 | Short familiar statements, then imperatives/reflexives, plurals, time phrases and harder sound sequences. |
| Mandarin listening words | 13 | 3 | 0 | Single-syllable verbs, then two-syllable combinations including neutral-tone 喜欢. |
| Mandarin listening sentences | 7 | 9 | 0 | Short formulas, then classifier/number combinations, particles, multiple verbs and time phrases. |
| Spanish listening words | 12 | 4 | 0 | Short frequent verbs, then longer forms with consonant groups and more unstressed syllables. |
| Spanish listening sentences | 9 | 7 | 0 | Short familiar statements, then questions, infinitives, requests, locations and progressive/time phrases. |

All 231 items retain their original text and remain reachable. No retained
listening item was labeled advanced just to fill an empty column. Level 3 can
still play earlier material, but introduces no new material in these three
listening banks. That is a coverage gap, not a passing progression result.

The exact item IDs, assigned levels, English meanings and reasons are recorded
in `artifacts/language-content-quality/readiness-20260907/retained-grading-review.json`.
The same directory contains the full before-catalogs and SHA-256 snapshot.
The batch application verified all six inputs against the snapshot before any
write and compared each resulting JSON object with its original plus only the
authorized metadata. A subsequent all-course runtime check exercised all levels.

## Unresolved review work

- No score increases. Independent review and audible listening evidence remain
  missing. In particular, Mandarin neutral/contextual tones cannot be verified
  by inspecting text or successfully calling speech synthesis.
- Grading does not establish good listening distractor contrasts or full
  objective coverage. These small retained banks still require content work.
- Czech conjugation glosses with broad senses need the contextual review pass,
  including `znamenat` (signify versus intending to say) and `smát se`
  (laugh/smile distinctions). They were preserved, not silently corrected from
  uncertain recollection during grading.
- Word World contextual dictionary selection (including Czech `Jak` in a name
  question) and missing image concepts (including calendar scenes) remain open.
- The unchanged rubric's gameplay-dependent transfer/review criteria remain
  unmet under the authorized content-only boundary.
