# English to Modern Standard Arabic course

The local `/ar/` development course delivers the agreed first-course scope:
2,500 unique Word World sentences and 600 distinct verb pairs. It uses the
shared application and remains pending independent linguistic, audible speech
and owner distribution review. No APK build or public deployment was performed.

## Architecture and content authority

[course.json](../apps/languages/arabic-standard/course.json) owns the language
pair, reading directions, capabilities, games, resources, learning goals and
delivery flags. English remains the audit and embedding authority. Arabic
targets use RTL surfaces while the English interface stays LTR; logical Unicode
text is preserved without injected bidi controls or presentation forms.

[Word World content](../apps/languages/arabic-standard/content/word-world/content.json)
is the editable sentence authority. The shared builder produces English concepts,
Arabic realizations and runtime views through the versioned Arabic policies.
Edit that source, then run `build-word-world-content.mjs --course ar`,
`language-content/validate.mjs --course ar` and the setup asset refresher in
`caatuu-dev`. Follow the [shared course guide](../tools/language-packs/README.md)
and [content evaluator guide](../tools/learning-evaluation/README.md).

## Language choices and coverage

The course teaches Modern Standard Arabic with authored vowel marks and
contextual hints for whole orthographic words, including attached articles,
prepositions and pronouns. It does not invent a transliteration or split Arabic
into character puzzles. Native review must check vowel marks, case endings,
idiomatic wording and English equivalence.

Sentences cover introductions, relationships, home, routines, food, shopping,
travel, services, accessibility, health, learning, work, technology, nature,
weather, leisure and experiences. They progress from concrete statements and
questions to negation, gender and number agreement, possession, relative clauses,
conditions, comparison, reported speech and short narratives. Grades are author
estimates; these counts do not establish human learning outcomes.

The sentence bank contains 778 level-1, 1,238 level-2 and 484 level-3 records.

| Game | Delivered content |
| --- | --- |
| Word World | 2,500 unique bilingual sentences with explicit word hints |
| Verb Nebula | 600 distinct citation-form verb pairs |
| Conjugation Comet | 75 lexemes, past and present, 150 paradigms and 1,950 assessed forms across 13 slots |
| Grammar Gravity | 24 families, 720 agreement examples and 500 nouns |
| Sounds Quasar | Exact reuse of the 600 verbs and 2,500 sentences for device speech |

Conjugation includes sound, weak and hamzated verbs with explicit authored
forms. Grammar distinguishes human dual/plural agreement from nonhuman plural
agreement. The selection follows [Arabic grammar references](https://openbooks.lib.msu.edu/arb201/chapter/2-2-grammar-in-context/)
and the [Arabic layout requirements](https://www.w3.org/TR/alreq/).
Case Cosmos lacks an Arabic case curriculum; Naturalization Nucleus uses a
Hanzi/pinyin contract; Memory Moon is not implemented. Those games stay excluded.

## Delivery and review status

Local browser delivery and its offline graph are prepared. The Android source
allowlist and provider declarations are present, including the target speech
locale; Android enablement and public Pages delivery remain off. Browser review
verified RTL targets, LTR cues and all 13 conjugation rows with reachable controls
at normal and narrow widths. This browser has no ready Arabic speech voice, so
audible Arabic has not been verified.

Content is original AI-assisted authoring with self-review, not native approval.
The Arabic curriculum retains `release-review-required` licensing metadata;
the [earlier owner grant](LICENSING.md) did not include Arabic. These explicit
external follow-ups do not extend the completed 2,500-sentence/600-verb task.

## Validation

Final content validation accepted all 2,500 English concepts and Arabic
realizations. Generated views and all browser offline catalogs are current;
the existing server served the final banks and profile with matching source
bytes. Fifteen focused Arabic, content-authority, interface and conjugation
capacity tests passed. Earlier browser checks and 76 conjugation tests cover
reading direction and the tall-board scrolling change.

The final full metadata inspection reported 2,500 playable Word World sentences,
zero missing or invalid usefulness/complexity fields, and zero empty complexity
interval candidates. Structural records and listening reuse remain separate
from independent learning content. Additional semantic model work was omitted
at the owner's request to keep completion brief; this inspection does not
certify translation quality or learning outcomes.
