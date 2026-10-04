# English to Scientific Neo-Latin

The local `/la/` course delivers the agreed first-course scope: 2,500 unique
bilingual sentences and 600 distinct verb pairs. It teaches scientific reading
in the tradition of Newton's *Principia*, using classical grammar and scientific
vocabulary. Qualified Latinist review remains pending. The original onboarding
did not build or publish an APK. Curriculum distribution is now approved for
the eight-course Android bundle.

## Language choices and finite inventory

The [Newton Project's 1687 Principia edition](https://newtonproject.ox.ac.uk/view/texts/diplomatic/NATP00074)
provides the historical reference. The course contains original teaching
examples, rather than an imported transcription. Its subjects include motion,
force, quantity of matter, density, measurement, light, geometry, definitions,
observations and arguments. Statements describe their example situation; this
language course is not a physics textbook or comprehensive Principia commentary.

The [Dickinson agreement reference](https://dcc.dickinson.edu/grammar/latin/agreement)
and [core vocabulary](https://dcc.dickinson.edu/latin-core-list1) inform the
grammatical and lexical choices. Review must check historical scientific senses,
vowel quantity, idiom and English equivalence across the banks.

Macrons are pedagogical quantity marks, not seventeenth-century typography.
Assessment preserves contrasts such as `puella / puellā`, `os / ōs` and
`legit / lēgit`. Search tolerates missing macrons and historical ligatures
`æ / ae`, `œ / oe`. Word tokens keep enclitics attached and have contextual
English hints. Speech uses the shared browser/Android device speech provider.
Audible Latin depends on device support. Pronunciation review is pending;
device speech does not establish Newton-era pronunciation.

| Game | Delivered content |
| --- | --- |
| Word World | 2,500 unique English/Latin sentences with word hints |
| Verb Nebula | 600 lexical infinitive/English pairs, including deponents and defective verbs |
| Conjugation Comet | 24 lexemes, 96 paradigms, 576 forms across six persons |
| Grammar Gravity | 24 families, 360 agreement examples and 150 gendered nouns |

The sentence bank uses **100 authored patterns** with explicit inflected lexical
tables. Twenty patterns use 25 physical bodies/materials; eighty use 25
scientific quantities. This produces 500 examples about physical bodies and
observations, and 2,000 about scientific reading and argument. These are bounded
authored expansions, not 2,500 independently composed passages. The levels are
250 introductory, 1,125 intermediate and 1,125 advanced records. Levels and
usefulness/complexity scores are editorial estimates, not CEFR certification or
measured human learning outcomes.

Patterns teach subjects and objects, genitive specification, dative assignment,
ablative instruments/prepositions, vocatives, passive voice, relative clauses,
accusative-and-infinitive statements, purpose/result clauses, indirect questions,
conditions, participles, gerundives and ablative absolutes. Conjugation covers
the four regular conjugations in present active, imperfect active, perfect
active and present passive indicative. Agreement contrasts masculine, feminine
and neuter, singular and plural, using first/second- and third-declension
adjectives. Shared masculine/feminine forms such as `aequālis` remain valid
syncretism. The finite banks do not claim exhaustive Latin morphology.

Case Cosmos currently owns a Czech-specific curriculum and stays excluded.
Sounds Quasar lacks approved Latin audio; Naturalization Nucleus has a
Hanzi/pinyin contract; Memory Moon is not implemented. Those games stay excluded.

## Architecture and maintenance

[course.json](../apps/languages/latin-scientific/course.json) owns the pair,
route, resources, games, namespaces, features and delivery flags. The course
uses the canonical shared app and engines. English remains the audit/retrieval
authority; Latin never becomes embedding input. The LTR adapter preserves
quantity distinctions through the shared language contract. The shared authored
projection helper declares speech independently of authored pronunciation guides.
Speech is enabled while pronunciation review remains pending.

[Word World content](../apps/languages/latin-scientific/content/word-world/content.json)
is the editable sentence authority. The shared builder generates English
concepts, target realizations and runtime views through the versioned Latin
policies. Other game banks are declared course resources under
`static/data/games/`. Follow the [course guide](../tools/language-packs/README.md)
and [manual evaluation guide](../tools/learning-evaluation/README.md). Run the
established commands in canonical `/workspace` inside `caatuu-dev`:

```sh
node tools/language-content/build-word-world-content.mjs --course la
node tools/language-content/validate.mjs --course la
node tools/language-packs/validate.mjs --sync-views
node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses
```

Local browser and Android delivery are enabled. Public Pages delivery remains
off. The Android source allowlist and English embedding-provider declaration
are prepared for a later build, including the standard device speech declaration.
Curriculum distribution is cleared under AGPL-3.0-only by the
[4 October owner approval](CURRICULUM_LICENSE_APPROVAL_20261004.json).
The schema's `native-review-required`
status means qualified Latinist review here, not a claim of modern native speakers.

## Verification and limits

Focused checks cover quantity-sensitive assessment, search, script/control
rejection, speech without pronunciation approval, confined projections, all six conjugation slots,
syncretic agreement, shared authoring contracts and interface content. Generated
views and browser setup catalogs are checked against their manifests. Browser
review checks local loading, enabled games, word hints and six conjugation rows.

The final complete metadata inspection is retained in ignored
`artifacts/learning-evaluation/content/la-scientific-final-20261002/`. It reports
4,186 playable units: 2,500 sentences, 600 verb pairs, 576 conjugated forms,
360 agreement examples and 150 nouns. Structural families/forms are not extra
independent lessons. English noun/verb homonyms across banks are intentional;
missing independent English on structural parents is reported separately from
playable examples. No model-based semantic inspection or human learning study
was run. Independent linguistic, licensing and audio follow-ups do not extend
the finite implementation task.
