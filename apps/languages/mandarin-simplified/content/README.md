# Mandarin course content

This directory contains fresh Mandarin realizations authored in the `zh-Hans`
script and locale. It does not reuse
the retired Chinese trainer or its corpus.

Edit [word-world/content.json](word-world/content.json), the complete Mandarin
Word World source. English concepts and target realizations are generated
compatibility views of it. Only its authored English `embeddingText` fields may
enter the English MiniLM embedder. The unified records connect stable concept
IDs to Simplified Chinese learner text, authored word
boundaries, and generic authored pronunciation objects. This pack explicitly
selects `mandarin-simplified-v1`; that named policy—not the shared schema—owns
the Hans, pinyin, and contextual polyphone checks.

The starter realization pack is a machine-assisted draft. Its language review
gate is intentionally `native-review-required`; it must not make the course
active or authorize approved authored pronunciation guidance until a qualified
Mandarin reviewer records approval. The first-party English concepts and Mandarin
realizations are release-cleared under `AGPL-3.0-only`. The disclosed
development course may be packaged and published in browser and APK builds;
pending native review is advisory for that distribution, not a publication
block. It may expose a separate catalog explicitly marked
`machine-assisted-preview`. That catalog does not alter the learner projection
or satisfy the activation and approved-pronunciation gate.

The pack declares `authored-word-tokens` with contextual token pronunciation.
Consumers must preserve those boundaries; deriving pronunciation from one Han
character at a time is not a supported fallback because polyphonic characters
depend on their word and sentence context. While the catalog remains
`native-review-required`, every authored pronunciation object is marked
`reviewed: false` and the learner runtime projection omits pronunciation
entirely. Native approval must update the catalog gate and all pronunciation
objects consistently before learner-facing adapters may consume them.

## Verb Nebula preview readings

Every row in the [Verb Nebula catalog](../static/data/games/verb-nebula/content.json)
owns explicit `reading` metadata aligned to its exact target and English verb
sense. Existing contextual Word World and Sounds Quasar readings are reused
where both text and sense match; remaining readings are authored explicitly.
The renderer does not infer a pronunciation from individual characters or
borrow an unrelated sense of the same written word. In particular, 还 means
returning something borrowed here and reads `huán`, while 系 means tying and
reads `jì`.

These readings remain `machine-assisted-preview`. All verb rows retain
`native-review-required`, and the course's approved-pronunciation capability
remains disabled. Tone colors and the optional pinyin display do not constitute
native review or pronunciation assessment. Syllables use lexical teaching
forms, including authored neutral tones, rather than predicting sentence-level
tone sandhi.

Context-sensitive spot checks include the dictionary entries for
[还](https://www.zdic.net/hans/还), [系](https://zdic.net/hans/系),
[播种](https://zdic.net/hans/播种),
[踏步](https://dict.revised.moe.edu.tw/dictView.jsp?ID=49275&la=0&powerMode=0),
[下载](https://www.trainchinese.com/v2/wordDetails.php?rAp=0&tcLanguage=en&wordId=12148),
and a [mainland neutral-tone teaching table](https://www.imtcme.edu.cn/jcjxb/info/1386/5129.htm).
Only pronunciation facts were checked; definitions and bulk dictionary content
were not copied.

The shared-runtime `mandarin-verb-readings.test.mjs` verifies the complete
playable inventory, exact glyph alignment, contextual polyphonic readings,
neutral syllables, listening-catalog consistency and retained review gates.
