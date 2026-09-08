# English–Spanish content expansion, 2026-09-08

Expanded all five enabled games in English → Spanish (`es`, European Spanish) and Spanish → English (`es-en`, American English). This is a completed content increment toward the unchanged [long-term targets](COURSE_CONTENT_EXPANSION_TARGETS.md), not completion of those target banks. No new course/game combination was enabled.

The pass adds 247 / 254 verb pairs, 180 / 180 Word World sentences, 88 / 85 complete conjugation paradigms, 257 / 142 grammar examples, 250 / 247 nouns, 411 / 284 listening words and 180 / 180 listening sentences (English → Spanish / Spanish → English). Listening reuses authored meanings; its records are not additional independent language concepts.

Each cell below is **L1 / L2 / L3**, counting assigned levels rather than cumulative playable pools. Grammar examples are nested within families, and each conjugation paradigm contains six forms. Existing levels were preserved.

| Course | Catalog | Before L1 / L2 / L3 | After L1 / L2 / L3 | Total before → after |
| --- | --- | --- | --- | ---: |
| English → Spanish | Verb Nebula | 84 / 108 / 76 | **107 / 226 / 182** | 268 → 515 |
| English → Spanish | Word World | 58 / 175 / 58 | **94 / 283 / 94** | 291 → 471 |
| English → Spanish | Conjugation Comet paradigms | 11 / 10 / 5 | **30 / 50 / 34** | 26 → 114 |
| English → Spanish | Grammar Gravity families | 3 / 3 / 2 | **3 / 5 / 3** | 8 → 11 |
| English → Spanish | Grammar Gravity examples | 36 / 36 / 24 | **105 / 152 / 96** | 96 → 353 |
| English → Spanish | Grammar Gravity nouns | 50 / 44 / 36 | **110 / 174 / 96** | 130 → 380 |
| English → Spanish | Sound Quasar words | 36 / 42 / 26 | **103 / 230 / 182** | 104 → 515 |
| English → Spanish | Sound Quasar sentences | 17 / 32 / 8 | **53 / 140 / 44** | 57 → 237 |
| Spanish → English | Verb Nebula | 54 / 52 / 38 | **92 / 164 / 142** | 144 → 398 |
| Spanish → English | Word World | 58 / 175 / 58 | **94 / 283 / 94** | 291 → 471 |
| Spanish → English | Conjugation Comet paradigms | 9 / 8 / 6 | **42 / 35 / 31** | 23 → 108 |
| Spanish → English | Grammar Gravity families | 2 / 2 / 2 | **3 / 3 / 3** | 6 → 9 |
| Spanish → English | Grammar Gravity examples | 12 / 12 / 12 | **58 / 60 / 60** | 36 → 178 |
| Spanish → English | Grammar Gravity nouns | 50 / 42 / 38 | **107 / 172 / 98** | 130 → 377 |
| Spanish → English | Sound Quasar words | 57 / 48 / 28 | **105 / 170 / 142** | 133 → 417 |
| Spanish → English | Sound Quasar sentences | 18 / 57 / 47 | **54 / 165 / 83** | 122 → 302 |

Conjugation supporting forms increased from 156 to 684 in Spanish and from 138 to 648 in English. No tense, subject set, difficulty-selection rule or game interaction was added.

The new sentences cover animals, gardens, weather, art, music, school, food, home, friendship, travel, mathematics, science, reasoning, planning and imaginative adventures. They include requests, questions, comparisons, past and future events, cooperative problem solving and explanations. Both courses share the 180 new English concept IDs, while keeping complete Spanish target tokens or Spanish learner-base token meanings as appropriate. Retrieval descriptions are authored scene descriptions; scene-asset lists remain empty for these additions.

Spanish grammar adds possessive **nuestro**, the shortened ordinal **primer**, and comparative **mejor** families, with deeper examples in the eight retained families. English adds existential **there is / there are**, negative **is not / are not**, and countability **a little / a few**, with deeper examples in the six retained families. Morphological contrasts are counted as examples within their families, not as independent families.

**Review and remaining uncertainty.** All new material received an AI author re-read and structural checks, recorded in 135 bounded review batches. This is author self-review, not independent AI, human, or native-speaker approval. The existing native-review, pronunciation and licensing gates and earlier review notes remain exact. Word World pronunciation remains `null` under the existing Spanish/English policies. Device speech remains `unreviewed`; no audible voice/device test was performed.

The re-read corrected an initial feminine-gender error for *águila*, three token-alignment errors, contextual hints in 59 draft sentences, American English “turn,” and translation precision. Four initial sentence ideas were replaced to avoid overlap; a replacement snail sentence also overlapped retained Spanish content and was replaced with the lizard sentence `ww-pair260908-063`. No old sentence was removed. Final normalized near-duplicate screening at similarity 0.77 found no remaining flagged pair in these additions; this heuristic does not prove semantic uniqueness.

The grammatical gender of the bird *águila* and the meaning-dependent gender of *cometa* were checked against the [RAE entry for águila](https://dle.rae.es/%C3%A1guila) and [RAE entry for cometa](https://dle.rae.es/cometa). These sources support specific checks, not approval of the full bank. Remaining native-review priorities are polysemous isolated verbs, fine distinctions in advanced scientific vocabulary, natural Spain usage, English countability and regional plural variants, and the pedagogical clarity of contextual function-word hints. Eight held-out examples received an author editorial assessment outside the game banks; no learner-transfer results or new benchmark score are claimed.

**Validation performed.** Both documented Word World builders completed; both `--check` runs reported zero stale outputs. Both language validators passed with 471 English concepts and 471 target realizations. Both targeted setup-refresh checks reported current integrity metadata for 45 artifacts per course. The production verb, conjugation, grammar, noun and listening validators passed on the exact imported content. All grammar examples and noun items were reachable at their eligible difficulties, and every conjugation paradigm produced meaning, matching and helix rounds with six forms. A total of 11,224 listening rounds checked every eligible record at all three difficulties in both modes and all four offered choice sizes, including distinct choices and exactly one correct answer.

Live checks matched SHA-256 and byte lengths for 19 served JSON resources and verified 17 corresponding offline entries. The Android source publication plan matched the existing compiler plan, and all three source-contract tests passed. No APK, deployment, new container, host dependencies or image generation was used.

The focused repository test run finished with **127 passes and 16 failures**. Failures comprise one old grammar-family count (8 versus 11), six old listening-bank counts, three listening tests that assume the bank fits old finite-session/choice limits, and six Word World count or last-record/coverage assertions tied to the old 250-record catalogs. Some failures concern retained Czech/Mandarin expansions. These tests were not changed or weakened. The production round constructors were checked directly with valid existing session sizes; larger banks do not change the existing controls or session caps. The final single-sentence correction was rechecked through the data/round validators, builders, language validators, integrity checks and live delivery.

**Preservation and scope.** Recursive comparison preserved all 40,791 pre-existing scalar values in the twelve authoring catalogs, every old array position and every original record. New-record listening links were verified against 1,055 exact source references. Catalog configuration (`copy`, axes, gameplay, lanes, audio, presentation and other existing metadata) remained unchanged. This pass changed no game logic, interfaces, styles, controls, scores, rewards, progression, rubric, tests, image retrieval or Czech optional generation mode. The service-worker changes are generated cache-revision comments only.

The shared worktree contained concurrent changes. The established setup refresher picked up current shared bootstrap/chrome URLs and hashes while preserving those changes. The content validation above is not a claim of complete UI/music validation for concurrent edits. Work remained in canonical `C:\Work\caatuu` using the existing `caatuu-dev` container bound at `/workspace`. Handoff ref checks found only local `main` and remote-tracking `origin/main`; no branch, commit or staging operation was created.

**Files changed by this pass.** Twelve authoring JSON files and sixteen documented generated/catalog-integrity files changed, plus this report. Word World compatibility/runtime files were written only by the existing builder; setup integrity was written by the existing refresher.

- `apps/language-runtime/static/data/english-concepts/word-world-es-en-v1.json`
- `apps/language-runtime/static/data/english-concepts/word-world-es-v1.json`
- `apps/languages/english-from-spanish/content/word-world/content.json`
- `apps/languages/english-from-spanish/content/word-world/starter-v1.realizations.json`
- `apps/languages/english-from-spanish/static/data/games/conjugation-comet/content.json`
- `apps/languages/english-from-spanish/static/data/games/grammar-gravity/content.json`
- `apps/languages/english-from-spanish/static/data/games/grammar-gravity/nouns.json`
- `apps/languages/english-from-spanish/static/data/games/sound-quasar/content.json`
- `apps/languages/english-from-spanish/static/data/games/verb-nebula/content.json`
- `apps/languages/english-from-spanish/static/data/games/word-world/content.json`
- `apps/languages/english-from-spanish/static/data/games/word-world/learner-base.json`
- `apps/languages/english-from-spanish/static/data/games/word-world/manifest.json`
- `apps/languages/english-from-spanish/static/setup-assets.json`
- `apps/languages/english-from-spanish/static/sw.js`
- `apps/languages/shared/english-concepts/word-world-es-en-v1.json`
- `apps/languages/shared/english-concepts/word-world-es-v1.json`
- `apps/languages/shared/learner-base-realizations/es-ES/word-world-starter-v1.json`
- `apps/languages/spanish/content/word-world/content.json`
- `apps/languages/spanish/content/word-world/starter-v1.realizations.json`
- `apps/languages/spanish/static/data/games/conjugation-comet/content.json`
- `apps/languages/spanish/static/data/games/grammar-gravity/content.json`
- `apps/languages/spanish/static/data/games/grammar-gravity/nouns.json`
- `apps/languages/spanish/static/data/games/sound-quasar/content.json`
- `apps/languages/spanish/static/data/games/verb-nebula/content.json`
- `apps/languages/spanish/static/data/games/word-world/content.json`
- `apps/languages/spanish/static/data/games/word-world/manifest.json`
- `apps/languages/spanish/static/setup-assets.json`
- `apps/languages/spanish/static/sw.js`
- `docs/SPANISH_PAIR_CONTENT_EXPANSION_20260908.md`

**Concurrent paths observed changing since the baseline** (preserved, outside this pass):

- `apps/language-runtime/static/app/index.html`
- `apps/language-runtime/static/source/app-bootstrap.mjs`
- `apps/language-runtime/static/source/background-music.mjs`
- `apps/language-runtime/static/source/caatuu-chrome.js`
- `apps/language-runtime/static/source/legacy-page-bootstrap.mjs`
- `apps/language-runtime/static/source/music-controls.mjs`
- `apps/language-runtime/static/styles/caatuu-chrome.css`
- `apps/language-runtime/static/styles/caatuu-home.css`
- `apps/language-runtime/static/styles/music-controls.css`
- `apps/language-runtime/tests/background-music.test.mjs`
- `apps/language-runtime/tests/chrome-ui-behavior.test.mjs`
- `apps/language-runtime/tests/music-controls.test.mjs`
- `apps/languages/czech/static/audio-lab.html`
- `apps/languages/czech/static/case-cosmos.html`
- `apps/languages/czech/static/chat.html`
- `apps/languages/czech/static/embedding-images.html`
- `apps/languages/czech/static/setup-assets.json`
- `apps/languages/czech/static/verb-difficulty.html`
- `apps/languages/mandarin-simplified/static/setup-assets.json`

Audit evidence is retained under `artifacts/language-content-quality/spanish-pair-expansion-20260908/` (Git-ignored): `baseline.json`, `baseline-hashes.json`, `before-inventory.json`, `final-inventory.json`, `added-records.json`, `candidate-validation.json`, `import-receipt.json`, `content-correction-receipt.json`, `hint-corrections.json`, `near-duplicates.json`, `review-batches.json`, `held-out-editorial.json`, `focused-tests.log` and `verification.json`. These are evidence/draft artifacts, not new runtime authoring authorities.
