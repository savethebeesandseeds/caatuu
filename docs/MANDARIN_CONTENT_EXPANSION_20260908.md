# Mandarin content expansion — 2026-09-08

This Mandarin-only pass adds 259 playable verb pairs, 300 Word World sentences, 472 characters, 563 listening words and 300 listening sentences. Listening sentences reuse Word World; these are overlapping catalog counts, not independent learning outcomes. All four already enabled Mandarin games expanded. Campaign needs no separate bank.

The work follows [the catalog guide](GAME_CONTENT_CATALOGS.md) and [the existing expansion targets](COURSE_CONTENT_EXPANSION_TARGETS.md). It is a substantial completed increment toward those long-term banks, not completion of the 25,000-sentence course or a proficiency certification.

## Before / after difficulty matrix

Counts are assigned L1 / L2 / L3 records, not cumulative selectable pools. Existing grades were retained. There are no ungraded additions.

| Catalog | Before L1 / L2 / L3 | After L1 / L2 / L3 | Total before → after | Added |
| --- | --- | --- | ---: | ---: |
| Verb Nebula | 84 / 108 / 73 | 120 / 233 / 171 | 265 → 524 | 259 |
| Word World | 58 / 176 / 58 | 118 / 356 / 118 | 292 → 592 | 300 |
| Naturalization Nucleus | 47 / 66 / 55 | 153 / 339 / 148 | 168 → 640 | 472 |
| Sound Quasar words | 21 / 7 / 1 | 214 / 295 / 83 | 29 → 592 | 563 |
| Sound Quasar sentences | 15 / 35 / 8 | 75 / 215 / 68 | 58 → 358 | 300 |

The current totals are 524 verbs, 592 Word World sentences, 640 characters, 592 listening words and 358 listening sentences. The long-term targets remain 1,800 / 25,000 / 3,000 / 3,000 / 6,000 respectively. Other courses received no authored learning-record changes in this pass.

## Coverage and editorial review

The 300 new sentences span 23 topics: animal friends, nature, school, home, play, feelings, everyday exchanges, gardening, woodland life, the sea, weather, seasons, creative projects, music and games, friendship, home skills, food, town life, discoveries, reasoning, cooperation, imaginative stories and caring for the planet. Exact topic counts and IDs are in the coverage ledger.

L1 uses concrete descriptions, simple requests and everyday functions. L2 adds connected events, comparisons, sequence, completed actions, practical transactions and collaboration. L3 adds conditions, concession, reasons, evidence, point of view, compromise and more precise lexical senses. The new Word World allocation is 60 / 180 / 60; the frozen rubric was not changed.

Examples include a dragon afraid of sneezing, a robot wishing for someone to admire stars with, a cardboard rocket for teddy bears, equal sharing, asking for useful help, garden experiments and a map whose symbols must be understood. No generated images or sentence-to-image requirements were introduced.

Review status: **AI author self-review only**. The 64 bounded review groups contain exact IDs and levels. No native-speaker, human, independent linguistic or audible review was performed or claimed. Existing review histories, licensing fields, reviewers and clearance timestamps were preserved. New listening-only provenance uses the existing `ai-editorial-reviewed` schema with an explicitly AI reviewer; it does not change device-speech status or native-review gates.

Corrections and exclusions:

- Excluded 22 candidate verb rows that duplicated or overlapped retained/new cards or had less useful content; changed the new adverb-like 轮流 card to the verb 轮换, “rotate roles.” Verb Nebula additions are lexical verbs in the established format.
- Replaced eight draft sentences that were too close to retained examples. A final normalized-text similarity screen found no pairs at its 0.77 threshold; this heuristic supplements editorial review and is not a semantic-uniqueness proof.
- Corrected inherited hints before reuse in new contexts, including measure words, ongoing versus locative 在, comparative versus verbal 比较, and 也 / 所有 / 开放 / 点 / 中 / 地方 / 错误. Original tokens were not rewritten.
- Distinguished 种 zhòng “plant” from zhǒng “kind,” 只 zhī as an animal counter from zhǐ “only,” 长 cháng / zhǎng, 数 shǔ and 角色 jué sè. The retained 倒 dào “pour” source remains distinct from new dǎo “fall over.”
- Corrected ambiguous draft 重用 to 再次使用, kept 打喷嚏 lexical, and refined two English translations for the music-stopping trigger and the heavy floating object.
- Repointed 林 away from a capitalized proper-name reading to an exact lowercase contextual reading. Repointed three more new character citations after sentence replacement; raised only new 题 and 累 entries to the level of their remaining sources.

Remaining linguistic uncertainties are native judgments of idiomatic collocations and register, editorial level placement, broad isolated-character glosses, regional neutral-tone/erhua conventions, and actual device-speech performance. New pinyin uses citation-tone 一 / 不 with lexical neutral syllables; it is not a full connected-speech tone-sandhi transcription. Polyphonic listening words, including 卡住, should receive native and audible review before pronunciation approval.

A limited reference check corroborated 角色 and 倒数 readings in the Ministry of Education dictionaries: [角色](https://dict.concised.moe.edu.tw/dictView.jsp?ID=24116), [倒數](https://pedia.cloud.edu.tw/Entry/Detail/?search=%E5%BE%80%E5%89%8D&title=%E5%80%92%E6%95%B8). [卡](https://dict.variants.moe.edu.tw/dictView.jsp?ID=4805&q=1) records regional readings and contextual uses; these references are checks, not imported licensed content or native approval.

Six held-out editorial examples recombine possession, counters, sequencing, polite requests, concession and reasons. They are excluded from game counts. Their assessment documents receptive coverage and the remaining gaps in spontaneous production, conversation and spoken fluency; it awards no rubric or CEFR points.

## Files changed by this pass

Authoring files:

- [apps/languages/mandarin-simplified/content/word-world/content.json](../apps/languages/mandarin-simplified/content/word-world/content.json)
- [apps/languages/mandarin-simplified/static/data/games/verb-nebula/content.json](../apps/languages/mandarin-simplified/static/data/games/verb-nebula/content.json)
- [apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json](../apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json)
- [apps/languages/mandarin-simplified/static/data/games/sound-quasar/content.json](../apps/languages/mandarin-simplified/static/data/games/sound-quasar/content.json)

Generated data and cache/integrity files, written by the established builder and setup refresh:

- [apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json](../apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json)
- [apps/languages/shared/english-concepts/word-world-starter-v1.json](../apps/languages/shared/english-concepts/word-world-starter-v1.json)
- [apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json](../apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json)
- [apps/languages/mandarin-simplified/static/data/games/word-world/content.json](../apps/languages/mandarin-simplified/static/data/games/word-world/content.json)
- [apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json](../apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json)
- [apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json](../apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json)
- [apps/languages/mandarin-simplified/static/setup-assets.json](../apps/languages/mandarin-simplified/static/setup-assets.json)
- [apps/languages/mandarin-simplified/static/sw.js](../apps/languages/mandarin-simplified/static/sw.js)

This report is the additional maintained documentation file. Audit snapshots, scratch authoring material and review evidence remain in the ignored artifact directory; none is a new runtime authoring source or pipeline. Normal future edits still use the four declared authoritative catalogs.

## Validation

All commands ran in the established `caatuu-dev` container mounted from canonical `C:\Work\caatuu` at `/workspace`. It was reused with its existing `debian:latest` image and `sleep infinity` command, bind mount and published port 8765. No container, branch, alternate checkout, host dependency, APK, deployment or commit was created.

- `build-word-world-content.mjs --course zh`: generated Mandarin views successfully; 592 complete records.
- Targeted `refresh-setup-assets.mjs`: refreshed Mandarin metadata using its existing manifest, static root, course manifest and `/zh` prefix.
- Final builder drift check: zero stale generated files. The language validator passed all 592 English/target joins. The targeted setup integrity check passed with 49 current artifacts.
- Production catalog validators accept all 524 verb pairs, both listening collections and all 640 characters. Every word and sentence retains an exact matching authored pronunciation guide.
- 8,152 listening rounds covered every eligible answer at all three difficulties, both existing manual modes and 2/4/6/8 choices. Answers and distractors were unique and stayed within the eligible difficulty pool.
- 2,703 seeded character rounds exercised 5- and 9-piece boards at every level and reached every eligible character. Every character citation exactly matches a runtime Hanzi/pinyin unit.
- All 8 checked live Mandarin/shared English JSON URLs matched canonical file bytes, including listening content, Word World, reading guides, characters, verbs and setup metadata. The existing server was reused.
- Final content/authoring/source-publication suite: 17 tests, 14 passed and 3 failed solely on retained starter counts (180 verbs, 250 sentences, 40 L1 characters). Safety, compositional pinyin, fixed historical reading cases, purpose-written retrieval text, independent course authoring and source-publication-plan checks passed.
- Existing game/browser suite: 154 tests, 142 passed and 12 initially failed. The one new exact-citation issue was corrected and its unchanged test rerun successfully. The remaining 11 failures are old bank-count assumptions or old finite-pilot assumptions (the bank being smaller than a 100-item session or a 20-choice request). Tests were not edited.
- Full Android asset-bundle compilation was not claimed in this pass. Source-only publication-plan checks passed. The prior cross-course handoff recorded a retained English “What is your name?” safety-gate conflict; that unrelated content was preserved and this pass does not resolve or revalidate that separate blocker.

No catalog ceiling, schema, validator, rubric, test, game mechanic, interface, control, scoring rule, reward, image-selection algorithm or difficulty-selection behavior was changed by this pass.

## Preservation and concurrent work

A recursive comparison preserved all 31,028 pre-existing scalar values across the four Mandarin authorities, including original array order, IDs, translations, hints, readings, difficulty, review history, licensing, audio configuration and round settings. No original record was removed or regraded.

The shared checkout continued changing during the pass. 50 baseline paths differed outside this pass’s allowlist at the final content audit, including shared bootstrap/chrome/music work, course manifests/profiles, other courses’ setup metadata and associated tests. Those changes were preserved. This report attributes only the four authoring files and necessary generated data listed above to the Mandarin expansion; it does not claim that concurrent interface code is byte-identical or that later concurrent changes are validated.

Canonical main-only checks passed: `main` was current, `refs/heads/main` was the only local branch and `refs/remotes/origin/main` the only remote-tracking branch. No non-main branch was found.

## Evidence

Local, Git-ignored evidence lives under
`artifacts/language-content-quality/mandarin-expansion-20260908/`.
These files are available in the canonical workspace, not in repository exports:

- `verification.json` — counts, preservation, round checks, served hashes and concurrent paths.
- `baseline.json`, `baseline-hashes.json`, `baseline-status.txt` — pre-expansion state.
- `after-inventory.json` — official final inventory for all 20 enabled course/game pairs.
- `added-records.json`, `review-batches.json`, `coverage.json` — exact IDs, levels and coverage.
- `editorial-decisions.json`, `editorial-corrections-applied.json`, `context-overrides.json` — language corrections.
- `citation-corrections.json`, `replacement-citation-corrections.json` — exact citation repairs.
- `near-duplicate-review.json`, `held-out-editorial.json`, `deferred.json` — editorial checks and exclusions.
- `content-final-tests.log`, `game-tests.log` — unchanged repository test results.
