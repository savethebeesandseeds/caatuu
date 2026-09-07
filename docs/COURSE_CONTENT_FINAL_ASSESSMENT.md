# Course content pass: final assessment

Completed 2026-09-07 against the bounded
[content-only execution plan](COURSE_CONTENT_EXECUTION_PLAN.md). The user asked
to finish this pass after the completed milestones, rather than continue an
open-ended expansion cycle. This closes the readiness, correction and reporting
work. **It does not certify that all courses reached 85.** The
[frozen benchmark](COURSE_CONTENT_QUALITY_BENCHMARK.md) and its baseline scores
remain unchanged.

## Delivered work

- Normalized runtime catalog names, retaining separate supporting catalogs and
  their authoring authorities. See [catalog conventions](GAME_CONTENT_CATALOGS.md).
- Graded and self-reviewed 231 retained items without changing their text,
  forms or IDs. See [grading review](COURSE_CONTENT_RETAINED_REVIEW.md).
- Corrected 180 contextual token hints: 94 in the first Spanish/English batch,
  four Czech `Jak` hints, 22 Spanish preposition hints and 60 Mandarin function
  hints. See [item-level context review](WORD_WORLD_CONTEXT_REVIEW.md).
- Preserved the compatible earlier additions: 30 English verb pairs, 85 English
  listening items, 16 English nouns, 30 Czech Case contexts and 26 Czech Grammar
  examples. English now has 46 verb pairs, 117 listening items and 40 nouns;
  Czech has 156 Case contexts and 188 active Grammar examples. Twelve additional
  invariant-adjective examples remain in authoring because the current assessed
  form stage cannot use them. See [gameplay recovery](COURSE_CONTENT_GAMEPLAY_RECOVERY.md).
- Registered the approved calendar in
  `apps/launcher/static/assets/visual-vocabulary/calendar-days.png`. The shared
  catalog has 305 images, preserving its previous 304 entries; the generated
  embedding index has 555 image descriptions including Macaw actions. Images
  continue to be semantic associations selected by the existing ranking.

The final closure adds documentation and audit evidence only. The preceding
content pass needed a bounded Czech hint-delivery repair in the compiler and
two adapters; it preserved authored hints through the existing display. The
earlier gameplay rollback and this repair are documented, rather than hidden
behind a claim that no runtime file ever changed. Concurrent shared edits were
preserved and are not represented as comprehensively reviewed here.

The final comparison specifically found later shared changes to
`apps/language-runtime/static/source/games/grammar-gravity/adjective-flight-host.mjs`
and `apps/language-runtime/static/styles/games/grammar-gravity.css`. These were
not changed by this closure. Their current hashes are recorded and their edits
are preserved. The earlier gameplay checks do not certify these later versions;
106 of the latest 108 protected paths still match. All 33 final inventory source
hashes and the 29 catalog hashes from the delivery proof still match.

## All 20 course/game pairs

All rows passed the catalog readiness checks at levels 1, 2 and 3, including the
declared listening modes, noun categories and offered board sizes. Counts below
mean **items introduced at L1 / L2 / L3**, not cumulative eligible pools. A
playable level can include earlier material; this does not prove new advanced
coverage. Technical checks do not award quality points.

The score column is the **unchanged initial estimate out of 100**, not a new
certified rating. Every row still lacks evidence for all fixed acceptance gates.

| Course | Game | Current authored counts: L1 / L2 / L3 | Baseline | Main remaining content or evidence gap |
| --- | --- | --- | ---: | --- |
| English → Czech | Verb Nebula | 45 / 73 / 32 pairs (150) | 75 | Bare-pair self-review completed; contextual direction/aspect objectives are not demonstrated by this interaction. |
| English → Czech | Word World | 175 / 565 / 52 sentences (792) | 80 | Four misleading `Jak` hints fixed; a fresh complete linguistic review of all 792 sentences was not performed. |
| English → Czech | Conjugation Comet | 20 / 20 / 19 paradigms (59; 354 forms) | 75 | All forms/cues self-reviewed; past auxiliaries/agreement and compound future objectives remain uncovered. |
| English → Czech | Case Cosmos | 93 / 39 / 24 contexts (156) | 70 | Added contexts reviewed; independent retained-bank coverage and transfer/review gates remain unproven. |
| English → Czech | Grammar Gravity | 7 / 7 / 8 families (188 examples); nouns 18 / 12 / 6 | 65 | Active examples self-reviewed; invariant soft-adjective material remains outside the active assessed-form stage. |
| English → Czech | Sound Quasar | Words 12 / 4 / 0; sentences 6 / 10 / 0 | 50 | No new L3 items; contrast breadth and actual voice/audio review remain open. |
| English → Mandarin | Verb Nebula | 60 / 70 / 50 pairs (180) | 70 | Bare-pair self-review completed; bringing/taking and contextual aspect coverage remain incomplete. |
| English → Mandarin | Word World | 50 / 150 / 50 sentences (250) | 75 | Sixty function hints fixed; review covered the affected token classes, not a new full native approval. |
| English → Mandarin | Naturalization Nucleus | 40 / 40 / 40 characters (120) | 65 | Citation readings/meanings self-reviewed; contextual polyphones, sandhi and compounds are not assessed. |
| English → Mandarin | Sound Quasar | Words 13 / 3 / 0; sentences 7 / 9 / 0 | 55 | No new L3 items; audible tone/sandhi review and broader contrast coverage remain open. |
| English → Spanish | Verb Nebula | 60 / 70 / 50 pairs (180) | 70 | Bare-pair self-review completed; `traer` is absent from the required `llevar/traer` contrast; contextual senses remain unproven. |
| English → Spanish | Word World | 50 / 150 / 50 sentences (250) | 70 | All 250 self-reviewed and 92 hints corrected across two batches; separate editorial approval remains outstanding. |
| English → Spanish | Conjugation Comet | 6 / 5 / 0 paradigms (11; 66 forms) | 70 | Present forms self-reviewed; no new L3 paradigms or required past/future/perfect coverage. |
| English → Spanish | Grammar Gravity | 3 / 3 / 2 families (64 examples); nouns 20 / 14 / 6 | 75 | Examples self-reviewed and nouns graded; full objective/contrast coverage and separate approval are not established. |
| English → Spanish | Sound Quasar | Words 12 / 4 / 0; sentences 9 / 7 / 0 | 50 | No new L3 items; actual audio review and broader contrast coverage remain open. |
| Spanish → English | Verb Nebula | 24 / 12 / 10 pairs (46) | 60 | Expanded bare-verb bank reviewed; unused sentence notes cannot count as contextual phrasal-verb assessment. |
| Spanish → English | Word World | 50 / 150 / 50 sentences (250) | 80 | Twenty-four contextual hints fixed; full separate retained-bank review remains outstanding. |
| Spanish → English | Conjugation Comet | 4 / 3 / 1 paradigms (8; 48 forms) | 65 | Forms/cues self-reviewed; required negative, progressive, past, perfect and future assessment coverage remains incomplete. |
| Spanish → English | Grammar Gravity | 2 / 2 / 2 families (24 examples); nouns 20 / 12 / 8 | 75 | Examples self-reviewed and noun expansion retained; quantity/question coverage and full review gates remain incomplete. |
| Spanish → English | Sound Quasar | Words 28 / 8 / 0; sentences 10 / 32 / 39 | 55 | Expanded text bank received earlier separate AI review; actual voice/audio review and full acceptance evidence remain outstanding. |

Czech Case counts combine 18 legacy seven-case paradigms with 30 added
contexts. Its 22 authored paradigm definitions are supporting data, not 22
additional playable rounds. Czech Verb Nebula projects 150 playable pairs from
865 raw dictionary records. Grammar family, example and noun counts are
different units and must not be added as if they were equivalent exercises.

Campaign has no separate content bank or independent acceptance score. Its
derived unchanged baseline estimates are Czech 73, Mandarin 72.5, Spanish
71.25 and English-from-Spanish 70, using the constituent games specified by
the benchmark.

## Fixed rubric assessment

| Dimension | Fixed floor | Final evidence assessment |
| --- | ---: | --- |
| Correctness and naturalness | 35 / 40 | Evidenced hint defects were corrected and rechecked. New retained-bank reviews are explicitly AI self-review. Separate review of all changed material and a complete stratified retained-bank audit are not established for every pair. |
| Breadth and variation | 20 / 25 | Counts and useful additions are verified, but every objective does not yet have the required varied practice and unfamiliar transfer evidence. Specific gaps are listed above. |
| Progression and pedagogy | 20 / 25 | Difficulty selection is checked. Practice-triggered transfer locks and separated scheduled review are outside the authorized content-only scope. Bare Verb Nebula pairs cannot establish excluded sentence assessments. These gates remain unmet. |
| Verification and review evidence | 8 / 10 | Source, projection, runtime-selector and delivery checks pass. Independent review coverage is incomplete and no actual listening voice/audio audit was performed in this pass. No APK/device validation is claimed. |

There is no justified new component breakdown or 85 certification for any pair.
The rubric has not been weakened to make the completed content work appear to
meet the broader target. Future work would need explicitly bounded coverage
batches, separate editorial review and audible checks; the conflicting gameplay
criteria need a separate user decision before they can be implemented or revised.
Those are recorded limits of this completed pass, not an automatically continuing
task list.

## Verification and review record

- Twenty-one readiness checks cover all 20 pairs and their declared difficulty
  and mode selections; ten contextual provider checks cover the final hint
  corrections. Earlier focused behavior checks and their fixture corrections
  remain in the [progress log](COURSE_CONTENT_QUALITY_PROGRESS.md).
- The latest delivery proof compares all 29 live browser JSONs with canonical
  bytes and all 25 Android learning catalogs with their canonical data. Android
  checks use the existing source-asset pipeline, without an APK build.
- Modern Word World authoring, projections and generated course views validate.
  All four offline setup declarations are current. Six focused image-index and
  Android delivery checks passed for the calendar registration.
- The final inventory captures all 20 pairs and 33 source SHA-256 hashes in
  `artifacts/language-content-quality/final-content-readiness-20260907.json`.
  `final-content-closure-20260907.json` beside it binds the final report to the
  current inventory, protected-file comparison, delivery hashes, image hashes and
  additional retained-review scope. This final hash audit reuses recorded
  delivery evidence; it is not a new device or end-to-end offline test.
- The last read-only review covered all 556 playable verb pairs, all 188 active
  Czech Grammar examples, and all 30 added Czech Case contexts. No definite
  textual correctness defect was identified in that scope. This is AI
  self-review, not independent or native approval. Earlier exact review IDs and
  hashes remain in `retained-text-review-20260907.json` and the batch records.

Work remained in canonical `C:\Work\caatuu`; only local `main` and remote
`origin/main` refs were present at closure. Existing content and authoring notes
were retained. No APK, deployment or release change was made by this pass.
