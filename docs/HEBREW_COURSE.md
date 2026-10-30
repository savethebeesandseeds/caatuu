# English → Hebrew

The first Hebrew course is a local browser development preview at
[`/he/`](http://127.0.0.1:8765/he/). It teaches Hebrew, labelled **עברית**,
to English speakers through the shared application and game engines. The
course ID is `he`, the script is `Hebr`, speech uses `he-IL`, text direction
is right to left, and storage and cache names start with `caatuu-he`. The
interface catalog is English `interface-en-57`.

The course is `development`. The browser is on, and the public website lists
it as a `noindex` preview. Android stays off, so
`apps/android/course-bundle.json` does not list it. License status is
`release-review-required`. Native review is `native-review-required`.

## Games

Each enabled game has one authored content file.

| Game | Content | Why it is on |
| --- | --- | --- |
| Word World | `content/word-world/content.json` | Sentences are the main teaching surface |
| Verb Lab | `static/data/games/verb-nebula/content.json` | Infinitive and short verbal expressions |
| Conjugation Comet | `static/data/games/conjugation-comet/content.json` | Written-out present and past forms |
| Grammar Gravity | `static/data/games/grammar-gravity/content.json` | Adjective agreement |
| Grammar Gravity nouns | `static/data/games/grammar-gravity/nouns.json` | The same game's noun bank, not a sixth game |
| Memory Moon | `static/data/games/memory-moon/content.json` | One question bank from the same course |

Case Cosmos stays off. Hebrew is not given a `grammatical-case` feature.
Naturalization Nucleus stays off. Sounds Quasar stays off because there is
no reviewed audio. Dictionary, chat, generation, and a listed campaign are
off. Device speech is on, through the shared provider. `pronunciationGuides`
is false. The content carries no pronunciation objects. `capabilities.verbs`
is false. Verb Lab still runs from its own content file.

## How Hebrew is written

Teaching text is modern Israeli Hebrew with full pointing. The reading aid
is a Latin line for English readers. It is on by default in Word World, Verb
Lab, Conjugation Comet, Grammar Gravity, and Memory Moon. Each game keeps its
own Show romanization setting. The line is a reading aid. It is not an answer
key and not a pronunciation claim.

בּ is `b` and ב is `v`. כּ and ךּ are `k`. כ and ך are `kh`. פּ is `p`. פ and
ף are `f`. שׁ is `sh` and שׂ is `s`. ח is `kh`. צ and ץ are `ts`. ק is `k`.
ט and ת are `t`. וֹ is `o`, וּ is `u`, and a consonantal ו is `v`. י is `y`
unless it is a silent vowel letter. ע is always `'`. א is silent. A vowelled
א at the start of a word has no apostrophe, so אִישׁ reads `ish`. A vowelless
א before וֹ or וּ takes an apostrophe even at the start of a word, so אוֹרֵחַ
reads `'oreakh`.

Sheva is silent, including at the start of a word, except the five prefixes
וְ בְּ כְּ לְ מְ, which read `ve` `be` `ke` `le` `me`. Any leading בְּ reads
`be`, so a form such as בְּרוּכָה is not used. Welcome is בָּרוּךְ הַבָּא.
A hataf vowel is a full vowel, so מַחֲזִיר reads `makhazir`. Dagesh does not
double a letter. A final ה with no mapiq is silent. A furtive patah on a
final ח comes before `kh`.

Answer checking strips niqqud and extra spaces. It does not lowercase and it
does not fold final letters. Search folds ך ם ן ף ץ to כ מ נ פ צ. Speech
keeps the pointing. A word the guide cannot read drops the whole guide.

A few spellings were left out because this guide would teach a wrong reading.
לָשֶׁבֶת would read `lashvet`, so the infinitive "to sit" is absent. The
present יוֹשֵׁב remains in Word World sentences. שְׁאֵלוֹת would read `shelot`,
so the noun bank uses שָׁעוֹת, `sha'ot`, for "hours".

## Agreement

Grammar Gravity uses four lanes: masculine, feminine, masculine plural, and
feminine plural. There is no dual. The adjective follows the noun and repeats
the article. The noun stays outside the answer slot. Level 0 is the family
"new": **The new book is here.**

Nouns in the noun bank are bare. Masculine nouns take the `-im` plural and
feminine nouns take the `-ot` plural. Mixed plural patterns are avoided.

## Level 0

Shared readiness checks require a real difficulty-0 band in every enabled
game. Level 0 is the short first-encounter band, not the whole course.

Word World level 0 is 67 short lines of letters and greetings. Conjugation
level 0 is the present of to read, to know, and to live. A present board has
four forms: a man, a woman, men, and women. The first harder present board is
to speak. Past boards have six forms at difficulty 3. They are taught as
"to write in the past", "to walk in the past", and "to buy in the past", so
none of them shares a meaning with a present board.
Grammar level 0 is the "new" family. Memory Moon level 0 is sixteen short
lines. Verb Lab level 0 is 48 infinitives.

## Ordinary life, with room for other people

Most of the bank is ordinary language: the alphabet, food, family, home,
work, study, the market, the bus, weather, time, and the city. Kindness is
a texture inside that language. Of 2,500 Word World sentences, 324 use the
people topic. Most of those are ordinary social lines, such as one person
listening with another. A smaller set models a shared meal, a guest at the
table, making room, returning a lost bag, an apology, and the plain cost of
hatred. The course does not preach, and it does not teach a nation, a
people, or a religion as an opponent.

## Authored counts

| Bank | Included units |
| --- | ---: |
| Word World | 2,500 sentences (67 / 995 / 1,069 / 369 by difficulty 0–3) |
| Verb Lab | 600 pairs (48 / 235 / 182 / 135 by difficulty 0–3) |
| Conjugation Comet | 31 boards, 130 written forms |
| Grammar Gravity | 16 agreement families, 128 examples |
| Noun practice | 80 bare nouns across the four lanes |
| Memory Moon | 64 questions (16 / 16 / 16 / 16 by difficulty 0–3) |

Memory Moon's content file records `spdxExpression` `AGPL-3.0-only` because
the content validator requires that project license expression. That
expression is not a release clearance. Independent native review is still
required for every bank.
