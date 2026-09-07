# Course content quality pilot reviews

Date: 2026-09-07. These are separate **AI editorial reviews**, not native-speaker
or independent human approval. The [benchmark](COURSE_CONTENT_QUALITY_BENCHMARK.md)
and [checkpoint log](COURSE_CONTENT_QUALITY_PROGRESS.md) remain authoritative.
No overall game score is increased by this pilot record.

## English Verb Nebula, pilot 1

**Superseded interaction:** the user rejected the sentence-based pilot on
2026-09-07. The linguistic review below records historical authoring findings;
it does not authorize sentence prompts or optional sentence help in Verb Nebula.
Current gameplay shows only verbs and translations, before and after answers.
Sentence variants are not selected or credited as assessed transfer. Runtime and
browser verification of this correction is recorded in the checkpoint log.

Author: android_all_courses (Codex agent). Reviewer: root (separate Codex agent).
Reviewed the entire 46-entry bank: original 16 IDs plus 30 new lemmas, all 92
practice/transfer contexts, learner-base translations, English audit values,
Spanish usage notes and the six objective assignments. All original 16 learner
labels and audit values remain intact. The context translations and highlighted
verb make the intended sense explicit; untested additional senses are not
implicitly covered.

Source: [English verb catalog](../apps/languages/english-from-spanish/static/data/games/verb-nebula/content.json).
Reviewed IDs share `es-en.verb.` and have these suffixes:

`be`, `have`, `do`, `go`, `come`, `want`, `need`, `speak`, `ask`, `listen`, `see`,
`understand`, `remember`, `eat`, `drink`, `sleep`, `read`, `write`, `study`,
`work`, `play`, `walk`, `run`, `open`, `close`, `help`, `buy`, `sell`, `pay`,
`borrow`, `lend`, `bring`, `take`, `leave`, `arrive`, `choose`, `look-after`,
`find-out`, `give-up`, `put-off`, `turn-down`, `apply-for`, `agree`, `suggest`,
`solve`, `improve`. Each associated `.transfer-v1` context was also reviewed.

| Finding | Correction / recheck |
| --- | --- |
| `speak` usage note made an absolute restriction on speaking particular words | Softened to usual speak/say distinctions with a truthful exception. Revised note read and accepted. |
| `read` context did not signal the intended habitual present | Added every morning / always and corresponding Spanish cues. Rechecked meaning and authored spans; actual TTS pronunciation is still unverified. |
| `eat` translated lunch as a fixed noon time | Changed to a meal-based translation; rechecked. |
| `go.transfer-v1` suggested collecting guests rather than meeting them | Changed Spanish to recibir a nuestros invitados; rechecked. |
| `take.transfer-v1` used an unnatural abstract Spanish recycling noun | Changed to material para reciclar; rechecked. |
| `arrive` translated early with an underspecified antes | Changed to con diez minutos de antelación; rechecked. |
| `turn-down` label excluded invitations and used awkward job-hours wording | Included oferta o invitación and changed to la jornada es demasiado larga; both contexts rechecked. |
| A full sentence can contain two verbs offered on the same board, such as want and be | Author added exact validated spans to every context and marks the intended verb in the actual renderer. Spanish sentence/usage help is withheld until answer/solution. Core/host tests cover marked spans, assisted attempts and locked transfer. Browser visual inspection remains pending. |

The reviewer found no additional unresolved linguistic error in this bounded
pilot after those corrections. This is **pilot text acceptance only**. Broader
domains, additional lexical contexts, cross-session behavior, browser/Android
delivery and the final fixed component scores still need completion. The
original native-review-required status has not been upgraded.

## Czech Case Cosmos, pilot 1

Author: check_course_exposure (Codex agent). Reviewer: root (separate Codex
agent). Reviewed the initial 29 new contexts in full, their 22 authored form
pools, English cues and explanations, then the requested corrections below.
Original 18 paradigms / 126 sentences were retained rather than relabeled as a
new full editorial review. Their stratified final re-audit is still pending.

Source: [Czech case catalog](../apps/languages/czech/static/data/games/case-cosmos/content.json).
Review scope is every `contexts` entry with the six prefixes `cz.case.roles.`,
`cz.case.absence.`, `cz.case.place.`, `cz.case.means.`, `cz.case.plural.` and
`cz.case.address.` in the 30-context pilot, including every reserved transfer.

| Finding | Correction / recheck |
| --- | --- |
| Plural instrumental transfer appeared before any plural instrumental practice | Added Mluvím se studenty as practice before the unfamiliar neighbor context; form and translation checked. |
| English plural doors added an unnecessary interpretation of Czech plural-only dveře | Changed the translation to a singular English door and explained Czech grammatical plurality; rechecked. |
| The pes dative pool omitted the short accepted form | Added psu as an accepted form alongside psovi; must remain a correct option whenever offered. |
| Stůl locative alternatives required source confirmation | Confirmed both stole and stolu in the dictionary source below; neither may be a false distractor. |

Primary-source checks support the listed forms: [ÚJČ student](https://prirucka.ujc.cas.cz/?slovo=student)
confirms student plural case forms; Masaryk University's [DICTIO stůl](https://www.dictio.info/cs/translate/czj/text/st%C5%AFl/76391)
lists both locative singular variants, and [DICTIO pes](https://www.dictio.info/cs/translate/czj/text/pes/64130?lang=cs)
lists psovi and psu. These are targeted lexical checks, not third-party approval
of the authored sentences or this product.

The pilot deliberately contrasts location na/v + locative with na + accusative
and do + genitive for destinations. Running within a park tests that motion
alone does not select accusative. The unchanged-form examples okno, knihy and
Marie require context rather than invented distinct case endings. The bounded
form pools need not provide unnatural examples for every theoretical case.

Final pilot acceptance still needs completed focused checks and observed host
behavior. A source/policy equality check protects reviewed text from drift; it
does not independently establish language quality. No Czech game is yet scored
at 85 under the fixed benchmark.

## English listening and noun pilots

Author: root (Codex agent). Separate review assigned to android_all_courses.
Listening has 50 new items plus metadata on 32 retained items; noun practice has
16 new items plus metadata on 24 retained items. Review findings, corrections
and rechecks will be added when that separate pass finishes. All listening
audio and provisional legacy contrast groups remain explicitly unverified.
