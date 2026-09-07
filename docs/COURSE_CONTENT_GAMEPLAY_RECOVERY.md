# Course content gameplay recovery

The user requested content improvements. The first pilot also changed game
selection, progression and interaction stages without authorization. This repair
withdraws those changes selectively and preserves useful authored material.
It does not complete the content quality goal or raise any benchmark score.

## Recovery boundary

Baseline: `350d168d8d2c6e4ece9150ca33f0c7f9ec69a50c`, before this goal's
uncommitted implementation. A verified snapshot of all 105 modified/untracked
files was saved before repair under
`artifacts/recovery/before-gameplay-repair-2026-09-07T15-22-29-324Z/`.
It contains a binary patch, working-files tar archive, SHA-256 manifest and the
initial repair's written-path list. The archive is recovery evidence only;
implementation, serving and validation use the canonical checkout on `main`.

## Restored behavior

- Verb Nebula: original queue, saved-board resume, matching, hints, speech,
  rewards and transition timing. Cards contain verbs and translations only.
- Sounds Quasar: original finite sessions, four choices, manual Words/Sentences
  selection, playback and rewards. No added curriculum scheduler or mode switch.
- Grammar Gravity: original noun practice and meaning/category/form sequence,
  round progression, rewards and timing. The added observation stage is removed.
- Czech Case Cosmos: original yes/no form check, feedback, transitions and full
  seven-case noun rounds. The original rounds come first; additional checked
  contexts follow at their authored difficulty without transfer locks.

Remaining code differences support content: family-specific grammatical
categories for Czech plural forms, honest first-party listening provenance,
checked Case context/form data and a shape-aware Case difficulty-change guard.
The shared metadata helper has no scheduling or history API. Cache revisions
make the repaired sources available in the existing web/offline asset workflow.

## Preserved content

| Bank | Before pilot | Active after repair | Preserved authoring |
| --- | ---: | ---: | --- |
| English verbs | 16 | 46 | All sentence examples and notes kept outside the game |
| English listening | 32 | 117 | All text, provenance, contrast definitions and review notes |
| English nouns | 24 | 40 | All expanded noun notes kept outside the game |
| Czech Case | 18 paradigms, 126 contexts | Same 18 plus 30 contexts | All checked forms, alternatives and notes |
| Czech Grammar | 18 families, 162 examples | 22 families, 188 examples | All 24 authored families and 200 examples |

The twelve `moderní`/`jarní` examples use one invariant form. They do not fit the
existing assessed-form stage with multiple legitimate choices. They remain in
the [Czech authoring bank](../apps/languages/czech/content/quality-pilot/grammar-gravity.json),
along with all 200 examples and teaching notes. They are not active game items.
English [verb](../apps/languages/english-from-spanish/content/quality-pilot/verb-nebula.json)
and [noun](../apps/languages/english-from-spanish/content/quality-pilot/grammar-gravity-nouns.json)
authoring banks preserve their full pilot notes. These are course content files,
not alternate applications or served copies.

Original Czech grammar corpus fingerprints remain pinned in regression tests.
Tests that demanded the withdrawn scheduler are replaced with retained-content
and original-interaction checks; their prior versions remain in the recovery
archive. Concurrent Home and Android changes are outside this repair.

## Verification

- All 445 affected game/content/safety/reference checks passed. The broad run
  passed 443 checks; its two failed reference checks were corrected and their
  complete 25-test suites then passed. Logs: `artifacts/recovery/final-tests.log`
  and `artifacts/recovery/final-reference-tests.log`.
- All 20 Android source-asset contract tests passed. This was the Node asset
  test suite, with no Gradle or APK build. Log:
  `artifacts/recovery/android-assets-test.log`.
- Four course views and offline catalogs are current. Language-content
  validation and all 750 Word World projection checks passed. The shipped Czech
  learner-content scan passed with 1,846 records and no findings. Repository
  file and Markdown link checks passed.
- Browser review on the existing local service confirmed the original grammar
  stages and Case Cosmos yes/no controls. Rejecting `Petrem` retained the same
  genitive sentence and changed only the candidate noun form. English Verb
  Nebula resumed the saved listen/work/speak/remember board, including the
  already matched work/trabajar pair, with verbs and translations only.
  Sounds Quasar retained its manual Words/Sentences selector and four choices.
  This was visual/interaction review, not an audible voice-quality assessment.
- All 29 protected Home/Android files matched the pre-repair SHA-256 snapshot.
  The original verb, adjective-flight and noun cores match the baseline exactly.
  The remaining host differences are cache URLs and the Case catalog-shape guard.
  Only `main` and `origin/main` exist; all work used the canonical checkout.

No APK build, deployment, release-version change, commit, branch operation or
other-task message was performed during this repair. The fixed quality rubric
and baseline scores are unchanged; the wider quality goal remains unfinished.

## Follow-up: missing verb images and requested Home update control

The preceding browser review missed incomplete picture coverage. The saved
English board showed images for `listen` and `speak`, but none for `work` or
`remember`. That review did not establish that every image loaded.

Verb Nebula now uses the existing shared English MiniLM image search rather
than requiring a course-specific vector database. Clue requests are serialized
so simultaneous cards do not lose semantic retrieval to model contention.
The existing action-name fallback remains for unavailable or timed-out model
requests. Available fallback candidates survive the deadline, and temporary
failures are retryable. The two existing exact artwork pins remain intact.
The temporary manual verb tags were withdrawn; the original image keymap is
byte-identical to its pre-repair snapshot. No artwork was removed.

The user separately requested moving **Update app** into **Local setup** with
an appropriate icon. The shared Home now places the button inside that card
with a refresh SVG, and status-label updates preserve the icon.

Verification: 77 focused image/game/Home tests and 37 asset/readiness/setup
tests passed. Real-browser review of the saved English board confirmed four
decoded images, including the previously missing `work` and `remember` clues;
both saved matches, rewards, and verb/translation labels remained intact.
The Czech Home showed the update control inside Local setup. Source auditing
confirms that workspace changes since the image-repair snapshot are confined
to image retrieval and its cache, and that all four Android course
configurations retain the shared image-search modules.

Evidence: `artifacts/recovery/verb-image-tests.log` and
`artifacts/recovery/image-repair-audit.json`. These checks do not establish
85% content quality, validate every semantic artwork choice, or test model
inference on an Android device. No APK was built and nothing was deployed.
