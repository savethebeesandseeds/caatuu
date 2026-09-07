# Spanish-to-English content review

Reviewed by Codex on 2026-09-07. Scope: the five enabled games in the
`es-en` course, including every sentence, word hint, paradigm, noun and phrase
example in the JSON files below. This is a practical editorial and software
review for the current playable course. It does not require hiring a teacher,
and it does not claim an independent human review or a finished curriculum.

After the corrections below, this is a usable small practice course. The grammar
and vocabulary banks need expansion, and content progression still needs design.
The existing `native-review-required` fields record that an independent human
review has not happened; they are not a claim that this editorial pass is missing.

## Content sources and findings

All enabled games load their course material from declared JSON files. Shared
JavaScript supplies game mechanics, layouts and shuffling. Word World combines
separate JSON authorities by stable concept ID; its runtime files are generated
from those authorities and should not be edited independently.

| Game | Reviewed JSON | Findings |
| --- | --- | --- |
| Verb Nebula | [core-vocabulary.json](../static/data/games/verb-nebula/core-vocabulary.json) | All 16 English verbs and Spanish meanings read. The meanings are suitable basic vocabulary; `be` correctly includes both `ser` and `estar`. All entries are difficulty 1. |
| Word World | [English concepts](../../shared/english-concepts/word-world-starter-v1.json), [English targets](word-world/starter-v1.realizations.json), [Spanish sentences and token hints](../../shared/learner-base-realizations/es-ES/word-world-starter-v1.json) | All 250 sentence pairs and their token hints read. Spanish sentence translations are usable; several word hints needed contextual corrections. English target wording needed three American-English adjustments. |
| Conjugation Comet | [verbs.json](../static/data/games/conjugation-comet/verbs.json) | All 8 verbs, 48 person/form pairs, Spanish cues and teaching notes read. Present-tense forms and cues are correct. Repeated English forms and singular/plural `you` are deliberate and handled by answer matching. Only present simple is covered. |
| Grammar Gravity | [challenges.json](../static/data/games/grammar-gravity/challenges.json), [nouns.json](../static/data/games/grammar-gravity/nouns.json) | All 6 families, 24 phrase examples and 24 nouns read. Demonstratives, agreement, irregular plurals, translations and answer slots are consistent. The course correctly uses number rather than assigning gender to English nouns. |
| Sounds Quasar | [challenges.json](../static/data/games/sound-quasar/challenges.json) | All 16 words and 16 sentences read and checked against their vocabulary/Word World source IDs. Translations and targets agree. Device speech itself was not audited on a phone. |

Word World's served files are [manifest.json](../static/data/games/word-world/manifest.json),
[target projection](../static/data/games/word-world/starter-v1.realizations.json)
and [Spanish projection](../static/data/games/word-world/starter-v1.es-base.json).
The manifest also declares the shared English concept projection.

## Corrections made

Corrected 78 contextual token hints. Examples:

- `work` in a heating fault now means `funcionar`, not `trabajar`.
- `front desk` hints identify `recepción`; `service window` identifies `ventanilla`.
- `play` with the piano means `tocar`; `transfer` on a train means `hacer transbordo`.
- Infinitival `to` is distinguished from directional `to` in the reviewed examples.
- The two occurrences of `for` in `Thank you for waiting for me` have different
  explanations: thanking someone `por` an action and the phrase `wait for`.
- Idiomatic `You are welcome`, weather subjects, and several other phrases no
  longer receive misleading isolated literal hints.

Adapted three target sentences to the declared American English variety:
`playing soccer`, `at a university`, and `the ATM`. Their Spanish token indexes
were updated together. The shared English concept and embedding authority stays
unchanged; target wording can realize the same concept differently.

## Current selection and difficulty

Explorer, Traveler and Navigator map to levels 1, 2 and 3. Where authored
difficulty exists, eligibility normally includes **all levels up to the selected
level**, not only entries at that exact level. Selection is not uniform random
sampling with replacement across every game.

| Game/mode | Eligible items at levels 1 / 2 / 3 | Current selection |
| --- | --- | --- |
| Verb Nebula | 16 / 16 / 16 verbs | Shuffled queue, consumed before refilling. Saved rounds and queues can resume. Since all entries are level 1, higher difficulty does not add vocabulary. |
| Word World | 50 / 200 / 250 sentences | Filters by difficulty, excludes recent/requested exclusions, favours the lowest usage count and then the oldest seen entries; random tie-breaking. A selected-word mode narrows candidates first. |
| Conjugation Comet | 4 / 7 / 8 verbs | Filters by difficulty, shuffles within each tier, then visits easier tiers before harder ones. This is a short ordered pass, not a mastery-based course progression. |
| Grammar Gravity phrases | 8 / 16 / 24 examples | Filters by difficulty and shuffles examples, then separates repeated noun/subject anchors while preserving the eligible examples. |
| Grammar Gravity nouns | 24 / 24 / 24 nouns | Whole-bank shuffle; no per-noun difficulty metadata/filter. A first mistake may append one later retry when another noun can separate it. Fall speed is a separate control. |
| Sounds Quasar | 16 words or 16 sentences at every level | Five distinct answers sampled from the chosen bank per session. Distractors also come from that bank. No authored content-difficulty filter; speech pace and choice count are separate concerns. |

The relevant implementations are the shared
[Verb Nebula core](../../../language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs),
[Word World provider](../../../language-runtime/static/source/word-world-provider.mjs),
[Conjugation Comet core](../../../language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs),
[Grammar Gravity core](../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs),
[noun core](../../../language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs)
and [Sounds core](../../../language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs).

Difficulty changes invalidate cached rounds in the shared hosts. Saved XP,
coins, streaks and completed rounds are not a sequence of mastered lessons.
This course disables Skill Compass; ordinary play has no prerequisite-driven
curriculum or automatic advancement through mastery levels. The usage ledger
and retry queues are basic repetition controls, not that future progression system.

## Follow-up content work

- Expand the small verb, conjugation, grammar and listening banks, especially
  the middle and upper levels. Navigator does not currently mean advanced English.
- Give Sounds and noun practice explicit difficulty metadata when their content
  banks grow. Decide how difficulty, exposure, mistakes and mastery should interact.
- Rebalance Word World's inherited themes: Chinese, pinyin and a `jin` price
  example are valid sentences, but disproportionately specific for an English starter course.
- Continue improving contextual word hints and coverage of common English forms;
  this pass does not establish a comprehensive dictionary or pronunciation curriculum.

## Verification

[Content tests](../tests/course-content.test.mjs) exercise grammar and bilingual
consistency; [sampling tests](../tests/content-sampling.test.mjs) read the real
JSON banks, check eligible coverage, and prepare Word World through its actual
three-file loader. Shared language-content checks validate schema, concept joins,
token coverage, projection parity and English-only retrieval. Repository CI now
includes every course's test folder, including Spanish and Spanish-to-English.

Validation result for this pass: 275 content and runtime tests passed. Schema,
concept/token alignment, all modern runtime projections, course-profile parity,
offline setup hashes, repository file policy and Markdown links also passed.

Run in the existing development container from the repository root:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --course es-en
docker exec -w /workspace caatuu-dev node tools/language-content/project-word-world-runtime.mjs --course es-en --check
docker exec -w /workspace caatuu-dev node --test apps/languages/english-from-spanish/tests/course-content.test.mjs apps/languages/english-from-spanish/tests/content-sampling.test.mjs tools/language-content/tests/english-policy.test.mjs
```

These corrections are source changes after APK 168. This review did not build
or deploy another APK.
