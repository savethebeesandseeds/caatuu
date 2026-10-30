# English → Russian

The first Russian course is a local browser development preview at
[`/ru/`](http://127.0.0.1:8765/ru/). It teaches Russian, labelled **русский**,
to English speakers through the shared application and game engines. The
course ID is `ru`, the script is `Cyrl`, speech uses `ru-RU`, and storage
and cache names start with `caatuu-ru`. The interface catalog is English.

The course is `development`. The browser is on. Public Pages and Android are
off, so the next APK does not pick the course up and
`apps/android/course-bundle.json` does not list it. License status is
`release-review-required`. Native review is `native-review-required`. This
course does not have the 2026-10-04 owner approval that cleared Georgian.

## Games

Each enabled game has one authored content file.

| Game | Content | Why it is on |
| --- | --- | --- |
| Word World | `content/word-world/content.json` | Sentences are the main teaching surface |
| Verb Lab | `static/data/games/verb-nebula/content.json` | Infinitive and short verbal expressions |
| Conjugation Comet | `static/data/games/conjugation-comet/content.json` | A small set of written-out finite forms |
| Grammar Gravity | `static/data/games/grammar-gravity/content.json` | Adjective agreement |
| Grammar Gravity nouns | `static/data/games/grammar-gravity/nouns.json` | The same game's noun bank, not a sixth game |
| Memory Moon | `static/data/games/memory-moon/content.json` | One question bank from the same course |

Case Cosmos stays off. That engine still teaches English-to-Czech cases with
Latin-script nouns. Russian's six cases would be taught wrongly there. Case
still appears inside Word World sentences and conjugation frames. Declaring
`grammatical-case` does not turn the planet on.

Naturalization Nucleus stays off. Its gate is only Mandarin tone color or
Arabic romanization. Sounds Quasar stays off because there is no reviewed
audio. Dictionary, chat, generation, and a listed campaign are off. Device
speech is on, through the shared provider. `pronunciationGuides` is false.
The content carries no pronunciation objects.

## How Russian is written

The reading aid is a Latin line, not Mandarin tone colors. It follows
BGN/PCGN for English readers: `ж` is `zh`, `х` is `kh`, `ц` is `ts`, `ч` is
`ch`, `ш` is `sh`, `щ` is `shch`, `ы` is `y`, and `й` is `y`. The hard sign
is `ʺ` and the soft sign is `ʹ`. `е` is `ye` at the start of a word and after
a vowel, `ъ`, or `ь`; otherwise it is `e`. `ё` is `yo` everywhere, including
`ёлка` → `yolka`, rather than BGN `ë`.

Stress is an authored combining acute on the Cyrillic vowel and is copied
onto the Latin vowel only. `мо́ре` reads `móre`. The guide does not guess
stress. Unmarked `ё` stays `yo`. Answer checking strips the acute and accepts
`е` where the authored form has `ё`.

The red line is on by default in Word World, Verb Lab, Conjugation Comet,
Grammar Gravity, and Memory Moon. Each game keeps its own Show romanization
setting. It is not an answer key and not a pronunciation claim. A word with a
letter outside modern Cyrillic, or a mark other than the combining acute on a
vowel, gets no guide.

## Agreement

Grammar Gravity uses four lanes: masculine singular, feminine singular,
neuter singular, and one plural lane. Nominative plural adjectives do not
mark gender (`но́вые` covers masculine, feminine, and neuter plurals). The
course does not invent three gendered plural lanes. Case endings are not
treated as adjective endings. The first family is "new", with the adjective
in the slot and the noun outside it: **Но́вый** стол здесь.

## Level 0

Shared readiness checks require a real difficulty-0 band in every enabled
game. Level 0 is the short first-encounter band, not the whole course.

Word World level 0 is the 33 alphabet sentences plus 24 greetings (57
sentences). Conjugation level 0 is a small set of plain present boards,
читать, знать, and жить, because a meaning round needs at least two distinct
meanings. The first harder present board is говорить. Past boards are four
forms and sit above level 0. Grammar level 0 is the "new" family, with more
than one anchor noun.

## Authored counts

| Bank | Included units |
| --- | ---: |
| Word World | 2,500 sentences (57 / 739 / 1,488 / 216 by difficulty 0–3) |
| Verb Lab | 600 pairs (48 / 399 / 75 / 78 by difficulty 0–3) |
| Conjugation Comet | 16 boards, 92 written forms |
| Grammar Gravity | 10 agreement families, 80 examples |
| Noun practice | 42 nominative forms across the four lanes |
| Memory Moon | 36 questions (12 / 8 / 8 / 8 by difficulty 0–3) |

Verb Lab level 0 is 48 common imperfective heads. Later bands add time and
place phrases, objects, case frames, and perfective infinitives whose English
differs from the imperfective. Aspect pairs are two items only when the
English meanings differ. Conjugation forms are authored, not generated. The
imperfective future is быть plus the infinitive. One perfective future board
is прочитать. Present "to be" is not given a six-slot board.

Memory Moon's content file records `spdxExpression` `AGPL-3.0-only` because
the content validator requires that project license expression. That
expression is not a release clearance. Independent native review is still
required for every bank.
