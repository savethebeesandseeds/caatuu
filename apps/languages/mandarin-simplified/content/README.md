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

The starter realization pack records `native-review-required`. That record
does not block the active course, and it does not authorize approved
pronunciation until a qualified Mandarin reviewer records approval. The
first-party English concepts and Mandarin realizations are release-cleared
under `AGPL-3.0-only`. The course is packaged and published in browser and
APK builds. It may expose a separate catalog explicitly marked
`machine-assisted-preview`. That catalog does not alter the learner projection
or satisfy the approved-pronunciation check.

The pack declares `authored-word-tokens` with contextual token pronunciation.
Consumers must preserve those boundaries; deriving pronunciation from one Han
character at a time is not a supported fallback because polyphonic characters
depend on their word and sentence context. While the catalog remains
`native-review-required`, every authored pronunciation object is marked
`reviewed: false` and the learner runtime projection omits pronunciation
entirely. Native approval must update the catalog gate and all pronunciation
objects consistently before learner-facing adapters may consume them.

## Pronunciation notation and contextual teaching

Word World and its linked listening previews use lexical citation tones for
一 and 不, together with explicit authored neutral syllables. They do not encode
all connected-speech tone changes. Experiential 过 is distinguished from the
lexical verb 过. Sentence, token and character-unit readings must compose exactly;
contextual pronunciation is never inferred from a default character reading.

Modern Word World records may declare `annotations.learning` with a stable unit,
presentation order, title, explanation and focus tags. Explicit
`annotations.acceptedTokenOrders` must preserve every canonical token and its
occurrence count. The shared builder projects these fields into the target
realizations, while English embedding text remains unchanged.

## Verb Nebula preview readings

Every row in the [Verb Nebula catalog](../static/data/games/verb-nebula/content.json)
owns explicit `reading` metadata aligned to its exact target and English verb
sense. Existing contextual Word World and Sounds Quasar readings are reused
where both text and sense match; remaining readings are authored explicitly.
The renderer does not infer a pronunciation from individual characters or
borrow an unrelated sense of the same written word. In particular, 还 means
returning something borrowed here and reads `huán`, while 系 means tying and
reads `jì`.

Pronunciation guides stay off. Tone colors and the optional pinyin display
are teaching aids. Syllables use lexical teaching
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

## Catalog fill

The English semantic banks remain the meaning source. Mandarin is the only
course currently derived from those banks. The other courses are using their
13 November catalogs until they are reinstated to that standard. Native
review is not claimed.

- Word World serves 8,994 sentences. Eight bank rows stay untranslated: five
  ask for a personal name, and three contain letters the English authority
  check rejects.
- Verb Nebula has 2,326 of 2,327 rows. "smoke" stays empty because the
  child-safety check rejects 抽烟.
- Naturalization Nucleus has 500 of 715 characters. Multi-character words are
  not truncated.
- Memory Moon has 598 of 603 sentences. Five punctuation twins of lines
  already in the catalog stay empty.
- Sounds Quasar has 2,072 words and 8,925 sentences projected from those
  verbs and sentences.
