# Course content quality goal progress

Goal started 2026-09-07. Status: bounded content-readiness pass completed;
the broader 85 target is not certified. Authority:
[current execution plan](COURSE_CONTENT_EXECUTION_PLAN.md) and
[fixed benchmark v1](COURSE_CONTENT_QUALITY_BENCHMARK.md).
No APK/Gradle build, release version change or deployment is authorized.

**Current execution, 2026-09-07:** the user authorized the
[content-only execution plan](COURSE_CONTENT_EXECUTION_PLAN.md) after filename
and difficulty repairs. The current checkpoints are below. The old checkpoint
and ownership tables later in this document are historical; this pass is local,
with no delegation or messages to other tasks. The frozen benchmark and all
baseline scores remain unchanged.

**Final handoff:** [all 20 pairs and remaining evidence gates](COURSE_CONTENT_FINAL_ASSESSMENT.md).
The user requested a finite conclusion after the completed milestones. This
pass ends with verified deliverables and an honest assessment, without starting
another expansion cycle. The final inventory records 20 pairs and 33 source
hashes; the closure audit checks that the cited current evidence still applies.
It found two later shared Grammar Gravity host/style edits and preserves them.
The final assessment records those exceptions; earlier gameplay checks are not
presented as validation of those later versions. Catalog inventory and delivery
source hashes remain unchanged.

| Current checkpoint | State | Evidence / next work |
| --- | --- | --- |
| 1. Protect and measure | Complete | Recovery copies of 29 catalogs; game implementation and frozen rubric hashes. New tests exercise all 20 pairs at levels 1-3, listening modes, noun categories and offered board sizes. |
| 2. Grade retained banks | Grading and self-review complete | 231 items in six catalogs now have authored difficulty; all text, forms and IDs preserved. [Batch review](COURSE_CONTENT_RETAINED_REVIEW.md) records distributions and reasons. Independent editorial review remains outstanding. |
| 3. Correct existing content | Completed correction batches; review limits recorded | Corrected 180 contextual hints. [Context review](WORD_WORLD_CONTEXT_REVIEW.md) records exact scopes, IDs and sources. The approved calendar is registered and delivered. Additional retained self-review is recorded in the final assessment; independent and audible review remain outstanding. |
| 4. Improve coverage | Completed bounded additions; coverage gaps recorded | Preserved the earlier 30 English verbs, 85 listening items, 16 nouns, 30 Czech Case contexts and 26 active Grammar examples added during this goal. Small Sounds banks and Spanish conjugation still introduce no L3 material. No levels were inflated to conceal gaps. |
| 5. Verify and reassess | Complete for this pass | All 29 live browser JSONs and 25 Android learning catalogs match canonical sources. Ten contextual checks and 21 readiness checks pass; projections and offline declarations are current. The final 20-pair assessment records every unchanged baseline score and unmet acceptance criteria. |

Batch evidence is under `artifacts/language-content-quality/readiness-20260907/`.
The first integration log intentionally retains the failed fixture run. Its
failures were four full-bank noun assumptions, one listening fixture that mixed
levels while testing bank size, and one storage mock/reload assumption exposed
by concurrent progress-journal work. Fixtures now select the intended level,
implement browser Storage enumeration, and reload all durable progress keys.
No production gameplay code was changed to satisfy these tests.

Eight shared runtime files changed concurrently outside this content batch:
`app-bootstrap.mjs`, `caatuu-chrome.js`, `caatuu-workspace.js`,
`learning-profile.js`, `legacy-page-bootstrap.mjs`, `product-word-world.mjs`,
`word-world-host.mjs` and `word-world-provider.mjs`. Those changes were preserved.
All 28 snapshotted game-specific files and the frozen rubric remained identical.
The catalog delivery verification is saved in `delivery-verification.json`.
The later shared-cache revision changes were incorporated by the established
setup-assets generator; its final check now passes for all four browser courses.
No claim is made that the external runtime edits were authored or comprehensively
reviewed by this content pass. Do not edit the active shared provider to address
the contextual dictionary issue while it overlaps.

The contextual-hint batch has separate evidence in
`artifacts/language-content-quality/context-hints-20260907/`: both complete
authoring backups, 94 item/token findings, 51 passing focused checks and a fresh
delivery verification. Full JSON comparison permits only those reviewed hints
and the appended review notes. Sentences, token boundaries, playable flags,
concept IDs, difficulty, review status and license fields are preserved. All 28
protected game-specific files and the frozen rubric still match the snapshot.

Czech's `ww-cp-000011` data-delivery gap is now repaired along with the other
three `Jak` occurrences. The shared provider was stable across inspections before
the bounded patch; its concurrent changes were preserved. The compiler inserts
sentence-bound token hints, two adapters preserve them, and authored context
takes precedence in the existing hint display. All dictionary entries remain.
The corpus normalizer changed only to retain an optional gloss field; its exact
diff is verified. The other 27 game-specific files and the fixed rubric are
unchanged. The follow-up evidence is under
`artifacts/language-content-quality/czech-token-hints-20260907/`.

The Czech follow-up passes 74 focused checks and 51 behavior checks across its
initial run and rechecks. The failures retained in the initial behavior log were
the stale offline corpus query and a mock browser missing its standard parent
and location references. The exact corpus URL is corrected; the fixture now
models those browser properties. No production behavior was changed to make
that fixture pass. The actual browser restored the previous unfinished round
and unchanged rewards; it was not answered during verification.

**Historical scope correction:** the gameplay repair paused content expansion.
The current execution plan resumes content work while preserving the original
interactions. See [the repair record](COURSE_CONTENT_GAMEPLAY_RECOVERY.md).
At that historical checkpoint no score had been raised and the quality goal
was not complete. The current bounded handoff is recorded above.

The approved calendar is now in the visual-vocabulary folder and shared keymap.
All 304 preexisting image entries are preserved; the 305-image catalog has exact
file/key parity. The generated shared index has 555 descriptions across visual
vocabulary and Macaw actions. Browser and Android source-delivered image,
keymap and index bytes match canonical files, and all four offline catalogs are
current. All 111 snapshotted content/runtime/rubric paths remained unchanged
during artwork registration. Six focused index/delivery checks passed. Evidence:
`artifacts/language-content-quality/calendar-20260907/registration-verification.json`.
The calendar participates in the existing nearest-embedding ranking; no forced
sentence mapping or retrieval-code change was made.

Retained-bank AI self-review also read all 120 Mandarin Nucleus characters and
their citation readings/meanings, all 66 forms and notes in the 11 Spanish
conjugation paradigms, all 64 examples in the eight Spanish grammar families,
and all 96 Czech/Mandarin/Spanish listening texts. No definite textual error was
identified in those banks during this pass. This does not establish independent
review, pronunciation quality, complete objective coverage or higher scores.
Mandarin contextual polyphone/sandhi assessment and Spanish past/future
conjugation objectives remain absent; existing levels are preserved.

The next retained text pass also read all 354 Czech and 48 English conjugated
forms/cues and all 24 English grammar examples. This remains AI self-review;
no new correctness defect was established in those banks. Source scope and
item IDs are recorded in
`artifacts/language-content-quality/retained-text-review-20260907.json`.

The Spanish preposition follow-up corrected 22 hints, preserved the 109 other
protected paths, and verified all 29 browser JSONs and 25 Android learning
catalogs. Its 21 readiness and seven contextual checks pass after fixing one
test-only token index. The Mandarin follow-up corrects 60 hints in 59 records,
with ten cross-course contextual provider checks passing. All three modern
authoring/projection contracts and generated browser views remain current.
Scores are unchanged. The final objective/coverage assessment is now recorded
in the linked handoff; its remaining gaps are not hidden by the passing checks.

## Historical checkpoints before the content-only restart

| Checkpoint | State | Evidence / remaining work |
| --- | --- | --- |
| 1. Freeze benchmark | Complete | Frozen rubric, floors, 20-pair objective map, evaluation cases and defects. Captured actual banks, playable verb projection IDs and 33 source SHA-256 hashes in `artifacts/language-content-quality/baseline-v1.json`. |
| 2. Prove improvement loop | In progress | Gameplay repair complete: original interactions restored. Active content: 46 English verbs, 36 listening words/81 sentences, 40 nouns, 30 added Czech Case contexts, 26 added Czech Grammar examples. Twelve invariant grammar examples and full teaching notes remain in authoring files. No score increased. |
| 3. Complete content waves | Not started | All 20 pairs need reviewed content and working progression. |
| 4. Verify integration | Not started | Browser, offline closure and Android Node asset pipeline; no APK. |
| 5. Reassess and close | Not started | No score increased yet. Every independent pair must pass total and component gates. |

## Historical work ownership and safety

- Root: benchmark, listening pilot authoring, shared concept/base authority,
  integration, final evidence and scorekeeping.
- web_all_courses: Sounds/noun shared cores and hosts, focused runtime tests.
- android_all_courses: English Verb Nebula pilot, core/context projection and
  scoped verb host behavior after benchmark freeze.
- check_course_exposure: Czech Case pilot and bounded case engine extension.
- All work remains in canonical `C:\Work\caatuu` on `main`; branch/ref checks
  precede writes. Existing `caatuu-dev` bind mount is canonical `/workspace`.
  Root coordinates generator/cache changes after source batches stabilize.

## Historical evidence gates before the final assessment

All baseline scores remain unchanged. Separate editorial reviews and corrections
are in progress; no pilot has passed all acceptance gates. Actual listening voice/audio review is outstanding for all four
courses. Existing native/license metadata is preserved and is not clearance.
Browser verification has confirmed the verb-only correction; broader integration
and Android asset checks remain pending.

The subsequent gameplay recovery passed its focused integration and Android
source-asset checks, documented in the repair record. This validates the repair;
the original goal's full 20-pair quality reassessment remains outstanding.

## Execution log

- 2026-09-07: user authorized selective gameplay repair after rejecting game
  redesigns. Backed up all 105 shared modified/untracked files. Restored the
  original controllers and core interactions, preserved compatible content and
  all authoring notes, and removed scheduling/history APIs. All affected checks
  and Android Node asset contracts passed. Browser verified saved verb-board
  resume, bare verb cards, original grammar stages, Case sentence persistence and
  manual listening mode selection. All 29 protected Home/Android files remain
  byte-for-byte unchanged. No APK or deployment; goal scores remain unchanged.

- 2026-09-07: user explicitly rejected sentences and phrase exercises in Verb
  Nebula, including optional examples. Removed all sentence rendering, optional
  help, sentence speech/transfer selection and extended reading delay. Kept verbs
  and translations before/after matching and on solution reveal. All 43 focused
  verb/core/campaign tests passed in canonical `caatuu-dev`. Reloaded the actual
  English-from-Spanish browser route and visually checked listen, work, speak,
  remember plus Spanish translations; matching work/trabajar showed no example
  or extra help. These are correction checks, not evidence for a higher score.
- 2026-09-07: corrected English Sounds bank now has 117 items (36 words,
  81 sentences): 85 authored graded items and 32 retained ungraded items. Separate
  AI reviewer web_all_courses read all records and found no concrete text or
  answer ambiguity defect. Actual voice/audio review remains outstanding; stress
  sentences also contain structural cues and are not isolated phonetic tests.
  Shared runtime needs its bounded retained-item review correction before final
  verification. Noun box/boxes explanation leak into reserved bus/buses transfer
  was corrected by root and separately rechecked by android_all_courses.

- 2026-09-07: created persistent goal. Verified canonical main, only main local
  and remote refs, running canonical container and no active alternate checkout.
  Read existing plan and source contracts. Read-only parallel inspection found
  difficulty/context selection gaps and strict Czech case/grammar constraints.
- 2026-09-07: froze benchmark v1 before authoring. The actual Sounds validator
  currently permits 500 items per collection; the plan's 80/240 figures were an
  earlier planning observation. No cap increase is needed or authorized by this
  correction; the planned initial content ranges stay unchanged.
- 2026-09-07: baseline inventory confirmed 150/180/180/16 playable verb pairs,
  792/250/250/250 Word World sentences, 59/11/8 conjugation paradigms,
  18 Czech case paradigms (126 contexts), 18/8/6 grammar families, 120 Mandarin
  characters and 16 words plus 16 sentences in each listening bank.
- 2026-09-07: English Verb pilot authored by android_all_courses; root separately
  read all 46 entries, 92 bilingual contexts and usage notes. Seven wording/sense
  refinements requested. Found a blocking renderer ambiguity when a prompt has
  two playable verbs; require a validated span marking the intended verb.
- 2026-09-07: root authored 50 English listening items (20 words, 30 sentences),
  retaining original 32 source-linked entries. Six objectives and reserved
  transfer examples declared. Shared-core validation passes; this establishes
  schema/provenance consistency only. Legacy contrast groups are provisional
  and must be refined before breadth/pedagogy acceptance. Separate language
  review and all audible checks remain pending.
- 2026-09-07: root separately read all 29 new Czech case contexts and 22 form
  pools authored by check_course_exposure. Requested explicit plural instrumental
  practice before its transfer, clearer English translation of Czech plural-only
  dveře, and primary-source confirmation of accepted stůl/pes variants. The
  [ÚJČ student entry](https://prirucka.ujc.cas.cz/?slovo=student) confirms the
  reviewed student plural forms; this limited source check is not approval of
  the whole Czech bank.
