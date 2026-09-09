# English → Norwegian Bokmål course

Added on 2026-09-09 in the canonical checkout on `main`, following the user's
explicit request to onboard Norwegian and adapt applicable games. The user
selected Bokmål. The course is available locally at
`http://127.0.0.1:8765/nb/index.html` and in the shared course picker. It is a
development preview: AI review is recorded honestly, with native-speaker and
curriculum-license approval still outstanding. No APK was built or published,
and no public site was deployed.

## Content matrix

These are records assigned to each level, not cumulative playable pools. Every
Norwegian bank began at zero. Supporting forms/examples and reused listening
records are separate counts, not additional independent lessons.

| Norwegian bank | Before L1/L2/L3 | After L1 | After L2 | After L3 | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| Verb Nebula — verbs | 0/0/0 | 150 | 250 | 200 | 600 |
| Word World — sentences | 0/0/0 | 120 | 360 | 120 | 600 |
| Conjugation Comet — paradigms | 0/0/0 | 40 | 40 | 40 | 120 |
| Conjugation — supporting forms | 0/0/0 | 160 | 160 | 160 | 480 |
| Grammar Gravity — families | 0/0/0 | 5 | 6 | 5 | 16 |
| Grammar — bilingual examples | 0/0/0 | 100 | 120 | 100 | 320 |
| Grammar — noun bank | 0/0/0 | 150 | 220 | 130 | 500 |
| Sounds Quasar — words | 0/0/0 | 150 | 250 | 200 | 600 |
| Sounds Quasar — sentences | 0/0/0 | 120 | 360 | 120 | 600 |

Word World contains 3,686 contextual word tokens across 56 topics. The material
includes greetings, school, friends, family, animals, imaginative adventures,
Norwegian nature, transport, food, requests, explanations and connected events.
Verb Nebula has 578 single-word infinitives and 22 conventional lexical verb
constructions; it contains no sentence exercises. Listening copies the exact
authored source text, meanings, levels and IDs into its existing format.

This is an expanded development bank; local listening playback requires the
Norwegian voice described below. It does not complete
the much larger [long-term targets](COURSE_CONTENT_EXPANSION_TARGETS.md), certify
CEFR attainment, or replace native review.

## Applicable games and Norwegian conventions

The five enabled games are Verb Nebula, Word World, Conjugation Comet, Grammar
Gravity and Sounds Quasar. Campaign reuses them. Case Cosmos and Naturalization
Nucleus are not enabled: their existing course contracts teach Czech case
paradigms and Mandarin characters respectively.

Conjugation Comet uses its existing four-form capability for infinitive,
present, preterite and present perfect. The finite verb does not vary by person
in Norwegian, so six person labels would add redundant cards. Each paradigm
includes exact English cues and Norwegian phrase frames. All 480 forms were
independently checked against active inflection forms in a single official
dictionary lemma, including the intransitive sense of `henge`.

Grammar phrases teach a valid common/neuter Bokmål convention. Its existing
meaning/form stages assess agreement without presenting equally valid feminine
choices as wrong distractors. The separate noun bank uses masculine, feminine
and neuter lanes. There are 139 nouns with multiple accepted genders, including
dictionary-attested alternatives beyond the usual en/ei pair. Bokmål permits
masculine inflection for feminine nouns; a feminine article may be chosen per
word. [Språkrådet](https://sprakradet.no/aktuelt/grammatisk-kjonn/)

The grammar scope covers regular adjective agreement, small/new/red/old/green,
warm/safe, demonstratives, possessives, simple/own/whole/important/other forms.
The structural distinctions were checked against
[NTNU's adjective guidance](https://www.ntnu.edu/now/4/grammar) and
[definite-form guidance](https://www.ntnu.edu/now/6/grammar). All bilingual
examples are newly authored; dictionary and course examples were not imported.

## Review and provenance

The tracked [review receipt](../apps/languages/norwegian-bokmal/content/reviews/onboarding-20260909.json)
records the six source-bank hashes, exact dictionary article references for
all 500 nouns and 120 conjugation paradigms, review coverage and limitations.
Official grammatical facts were checked through the
[UiB dictionary API](https://ord.uib.no/ord_2_API.html), with homographs matched
to the authored meaning. Definitions and example sentences were not copied.

AI author review covered all 600 sentence pairs and contextual hints. An
independent root pass read all 120 L1 and all 120 L3 pairs, with targeted L2
checks; a complete second review of every L2 hint is not claimed. All 320
grammar examples had independent AI review in addition to author review.
Corrections included contextual polite-reply hints, signature vocabulary,
word order, and translation precision. The final English spelling `cafe`
preserves the existing English retrieval-character policy without changing
Norwegian text or weakening validation.

No human/native approval is claimed. Remaining review needs are naturalness,
regional and optional Bokmål forms, age/level placement and device speech.
Device speech uses `nb-NO` and remains explicitly unreviewed. No IPA, invented
phonetic spellings or approved pronunciation guides are supplied. Legacy
devices that expose only generic `no` voices may need a separate tested voice
compatibility change; no Nynorsk voice is silently substituted.

The local Windows computer currently has English, Czech and Chinese voices,
but no Norwegian voice. Both Sounds Quasar banks load correctly; answering is
disabled with the explicit “No Norwegian … voice is ready” message until a
matching voice is available. Approval to install the Microsoft Bokmål voice
was requested as a narrow exception to the earlier no-host-dependencies
instruction; no installation has been performed. Microsoft lists the legacy
Norwegian voice as Jon and provides the supported installation procedure.
[Microsoft voice guidance](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices)

## Files and integration

- [Course manifest](../apps/languages/norwegian-bokmal/course.json), Android
  allowlist, embedding catalog, web manifest, adapter, setup catalog and service
  worker under `apps/languages/norwegian-bokmal/`.
- One editable [Word World source](../apps/languages/norwegian-bokmal/content/word-world/content.json).
  The documented builder generated its compatibility English/target catalogs,
  shared runtime English projection, target projection and manifest.
- Existing-format [verbs](../apps/languages/norwegian-bokmal/static/data/games/verb-nebula/content.json),
  [conjugation](../apps/languages/norwegian-bokmal/static/data/games/conjugation-comet/content.json),
  [grammar](../apps/languages/norwegian-bokmal/static/data/games/grammar-gravity/content.json),
  [nouns](../apps/languages/norwegian-bokmal/static/data/games/grammar-gravity/nouns.json),
  and [listening](../apps/languages/norwegian-bokmal/static/data/games/sound-quasar/content.json).
- Course/Android catalogs and shared asset allowlist register Norwegian.
  Generated picker and all five course profiles include the new course.
  Existing setup catalogs and cache markers include the new shared English
  projection/flag and changed shared-module hashes.
- New Bokmål content/projection policies and adapter preserve `æ`, `ø`, `å`,
  authored whole-word tokens, English-only retrieval and null pronunciation.
- Minimal shared adaptations: optional `acceptedLaneIds` in noun validation and
  answer checking, matching feedback for valid alternatives, and course-bound
  English provenance for Sounds Quasar. Absent optional noun metadata, existing
  behavior is unchanged. Corresponding import cache revisions were advanced.
- Focused Norwegian integration/policy/adapter/alternative-answer tests;
  inventory coverage now follows declared course/game combinations. Obsolete
  four-course expectations in onboarding tests are updated without weakening
  their route, flag, collision, mapping or status checks.
- Original [SVG flag](../apps/language-runtime/static/assets/home/norway_flag.svg)
  and PNG, with identical launcher PNG. The geometric rendering follows the
  official civil-flag 22:16 proportions, with no borrowed artwork.
  [Norwegian Ministry of Foreign Affairs](https://www.regjeringen.no/no/dep/ud/dep/diplomatiske-forbindelser-og-protokoll/norges-flagg-forskrift/id449230/)

Norwegian Android channels are registered for version 172 or later. At
onboarding this was above the source default 171; the subsequent user-requested
release preparation sets version 172 (0.1.20). Registration alone does not put
Norwegian in an already published APK. The source asset plan is ready;
publication retains the separate licensing gate.

## Preservation and validation

The before/after inventory captures all 25 final course/game combinations.
All 34 pre-existing source files in the baseline, including the existing
course manifests and learning catalogs, remain byte-for-byte identical. Their
20 course/game inventories are identical, including IDs and levels. The only
changed baseline catalog is the top-level course registry, which adds `nb`.

Existing scoring, rewards, timing, progression, controls, difficulty-selection
behavior, layouts, styles and image retrieval were preserved. No teaching text
was added to runtime JavaScript. Czech Word World's optional AI generation mode
is unchanged. Necessary shared changes are listed explicitly above; this is
not a claim that no interface/runtime file changed.

Concurrent maintenance changes already present at task start were retained in
the shared app HTML, app bootstrap, legacy bootstrap, maintenance UI and its
test. Existing setup metadata changes were retained while refreshing current
hashes. Onboarding created no branch, alternate checkout, host dependency
installation, APK, deployment or commit. The subsequent user-requested release
task prepares the version 172 source checkpoint separately.

Validation evidence lives under
`artifacts/language-content-quality/norwegian-onboarding-20260909/`, with grammar
round evidence under `norwegian-expansion-20260909/` in the same parent.

- All five Word World builders report zero stale generated files; Norwegian
  content validation passes for all 600 English concepts/target realizations.
- Course picker/profile synchronization and generated-view validation pass.
- All five setup manifests were refreshed with the documented tool.
- All 15 audited live catalog, profile, adapter, flag and registry URLs return
  the exact canonical file bytes.
- The 99 focused Norwegian, noun, adapter, policy and conjugation checks pass
  after correcting a missing required argument in the new integration test.
- All 640 cumulative grammar rounds validate: 100 L1, 220 through L2 and 320
  through L3, with reachable examples and distinct valid answer choices.
- Android source-plan/package-contract and Pages plan checks pass, 24 tests.
- Repository file policy passes for 2,722 tracked/candidate files; Markdown
  links pass for 179 files.
- Local browser checks cover all five games, contextual Norwegian word hints,
  the four-form conjugation helix, and acceptance of a valid alternate noun
  gender. Device speech is not a native pronunciation audit.

The broad course/generated-view/filename run initially passed 44 of 47 tests.
The subsequent release preparation resolves the obsolete live count/revision
assertions: expected CLI counts now come from fixture authoring sources, and
resource revisions and selector membership come from course manifests. The
two affected suites initially passed 43 of 46 tests, and the three repaired
tests then passed independently. Existing semantic, rejection, licensing and
native-review assertions remain intact; content was not changed for the tests.

Release preparation also passed 37 maintenance/Home/setup tests and 45 focused
Norwegian, package-plan and license-delivery tests. All five setup catalogs are
current. The all-course distribution check reports only the pending target
licenses for `es`, `es-en` and `nb`; the owner license decision is still required
before app publication.

## Existing-course matrix: before = after

Each cell is L1 / L2 / L3. A dash means the course does not enable that bank.

| Bank | English → Czech | English → Mandarin | English → Spanish | Spanish → English |
| --- | --- | --- | --- | --- |
| Verbs | 64 / 112 / 60 | 120 / 233 / 171 | 107 / 226 / 182 | 92 / 164 / 142 |
| Word World sentences | 183 / 590 / 60 | 118 / 356 / 118 | 94 / 283 / 94 | 94 / 283 / 94 |
| Conjugation paradigms | 25 / 25 / 24 | — | 30 / 50 / 34 | 42 / 35 / 31 |
| Grammar families | 7 / 7 / 8 | — | 3 / 5 / 3 | 3 / 3 / 3 |
| Grammar nouns | 48 / 42 / 36 | — | 110 / 174 / 96 | 107 / 172 / 98 |
| Nucleus characters | — | 153 / 339 / 148 | — | — |
| Listening words | 31 / 43 / 28 | 214 / 295 / 83 | 103 / 230 / 182 | 105 / 170 / 142 |
| Listening sentences | 14 / 35 / 8 | 75 / 215 / 68 | 53 / 140 / 44 | 54 / 165 / 83 |

Czech Case Cosmos retains 18 legacy paradigms (12/4/2), 22 authored paradigms,
and 185 contexts in total; its 59 authored contexts remain 19/20/20. Existing
grammar example totals remain Czech 249, Spanish 353 and English 178. Existing
conjugation form totals remain Czech 444, Spanish 684 and English 648.
