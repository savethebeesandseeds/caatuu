# Word World contextual hint review

Focused correction: 2026-09-07. Author: Codex. This is AI author review and
self-review, not independent editorial or native-speaker approval. It follows
the [content execution plan](COURSE_CONTENT_EXECUTION_PLAN.md).

## Corrections

The pass corrected 94 token hints in 59 existing records. All sentences, token
surfaces, positions, playable flags, concept IDs, English embedding text and
difficulty assignments are preserved. No game code or interactions changed.

| Course | Records | Correction |
| --- | ---: | --- |
| English to Spanish | 35 | All 34 occurrences of `por favor` now explain its polite-request meaning; both parts of `De nada` identify the response to thanks. Literal `for/by`, `of/from` and `nothing` no longer masquerade as their contextual meanings. |
| Spanish to English | 24 | Distinguish possessive `have/has` from perfect auxiliaries; explain time-placeholder `it`, object pronouns and omitted Spanish subjects in their sentence context; align `can` with the piano ability and `went` with the package's delivery context. |

The polite-expression decisions follow the
[Academia Mexicana de la Lengua's explanation of polite requests](https://academia.org.mx/consultas/consultas-frecuentes/item/por-favor-o-de-favor)
and [FundéuRAE's description of the reply to thanks](https://www.fundeu.es/consulta/de-nada-o-por-nada-22031/).
The English grammatical distinctions follow Cambridge's entries for
[have](https://dictionary.cambridge.org/dictionary/english/have) and
[it](https://dictionary.cambridge.org/dictionary/english/it).
The exact Spanish wording is this author's editorial decision, not a quotation
from those sources or a claim of their approval of the catalogs.

The existing English-course hints for `play` with an instrument, `front desk`,
`look for`, and `turn on/off` were already contextual. They were inspected and
preserved. Broader senses of Czech `smát se` and `znamenat` were not changed on
uncertain recollection; their review remains open.

## Evidence

`artifacts/language-content-quality/context-hints-20260907/` contains both full
before-authoring catalogs and `review.json`, with exact record/token IDs, old
and new values, reasons and original source hashes. Inputs were rechecked before
writing. Authoring source changes are projected using the existing Word World
generator; manually changing generated hints is not the authoring workflow.

The focused test uses the real provider, course declarations, runtime JSON and
learner-base join to check the hints that the game actually receives:

```powershell
docker exec -w /workspace caatuu-dev node --test tools/language-content/quality/word-world-context.test.mjs
```

The Spanish manifest's existing review-notes field was aligned with its source
because the projector treats the declared manifest shape as authoritative.
Native review and licensing states remain unchanged.

The final verification passes 51 focused checks, including every supported
course/game at every difficulty. Full authoring JSON comparison allows only the
94 reviewed hints and appended review notes. All 29 browser JSON files and 25
Android source-delivery learning catalogs match canonical files. The three
modern projections, generated course views and all four offline manifests pass
their currentness checks. These are source-delivery checks; no APK was built.
The 28 snapshotted game-specific files and frozen rubric are unchanged.

This pass does not establish correctness of every Word World record, audible
pronunciation or image relevance. No quality score has been raised.

## Czech contextual-hint follow-up

On 2026-09-07, the four annotated occurrences of `Jak` were reviewed across the
entire 792-record Czech bank: `ww-cp-000006`, `ww-cp-000011`, `ww-cp-000065` and
`ww-cp-000093`. They ask about well-being, a name, spelling and how something
works. The existing live dictionary contains the adverb, conjunction and animal
noun, but its general ranking selected `yak (mammal)`. All dictionary entries
remain intact. The adverb distinction follows
[Cambridge's English–Czech entry for how](https://dictionary.cambridge.org/dictionary/english-czech/how);
the sentence-specific hint wording is this author's editorial decision.

The separate authoring file
`tools/czech-ml/data/word-world/standard-v0.1/token-meanings.json` binds each hint
to its exact record ID, Czech sentence, English sentence, token position and
surface. The existing corpus compiler inserts it into runtime `content.json`;
changed sentences or token positions fail compilation. Historical source JSONL,
review receipts, all sentences, translations, IDs, levels, targets and playable
flags are preserved. The new hints have a separate same-author review status,
with no independent or human approval claimed.

Two data adapters previously dropped optional token glosses. The corpus target
normalizer now preserves that field, and the shared provider passes it to the
existing hint display using its exact position. An authored contextual hint
takes precedence over general dictionary ranking. Words without an authored
hint and the full dictionary keep their existing lookup. No selection, branching,
scoring, controls, saved-state behavior or Verb Nebula content changed.

Evidence under `artifacts/language-content-quality/czech-token-hints-20260907/`
includes exact backups, the live dictionary response and provider results,
full-catalog comparison allowing only four declared hints, and browser/Android
source-delivery verification. The corpus normalizer's complete diff is checked
to allow only optional gloss preservation; the other 27 protected game files and
the frozen rubric remain byte-identical. The 74 focused checks pass. The broader
behavior run exposed a stale offline corpus URL and an incomplete browser
parent/location fixture; their rechecks pass, covering 51 behavior tests in total.
The static dictionary supplement changed only its corpus hash.

The actual browser restored the existing unfinished Czech reconstruction round,
dictionary card, history and reward totals. It was left unanswered; this is not
a claim that the corrected `Jak` card was visually observed. Its four hints were
verified through the actual provider with the live dictionary response.

Broader retained-bank review and audible pronunciation review remain open.
The user clarified that nearest semantic images need not illustrate sentences
literally; a missing exact calendar scene is not a coverage defect.

## Spanish preposition-hint follow-up

The 250 Spanish sentences and their existing token hints received a full AI
self-review on 2026-09-07. A further 22 hints in 22 records were corrected:
18 compound-preposition links and four personal-object markers. This is not
independent or native approval, and it does not raise a quality score.

For example, `ww.routine.homework-after-dinner` previously glossed the `de` in
`después de cenar` as `of; from`. It now identifies its part in the expression
meaning `after`. The same bounded review covered every retained occurrence of
`antes de`, `después de`, `debajo de`, `detrás de`, `cerca del` and `junto a/al`.
The grammatical distinctions follow the
[Cambridge reference grammar's compound-preposition list](https://www.cambridge.org/core/books/abs/reference-grammar-of-spanish/compound-prepositionspreposiciones-compuestas/9EAA296C791FFB20785554F79A2C599A)
and the RAE entries for [antes](https://www.rae.es/dpd/antes) and
[después](https://www.rae.es/dpd/despu%C3%A9s).

The `a/al` hints in `ww.tech.call-grandmother`, `ww.family.visit-aunt`,
`ww.work.notify-change` and `ww.reason.finish-help` now identify the person or
team receiving the action. They no longer suggest an independent English `to`.
The [RAE entry for a](https://www.rae.es/dpd/a) documents this object marking.
Destination and time uses of `a/al` keep their existing meanings. The revised
hint wording is the author's editorial decision based on these distinctions.

Evidence in `artifacts/language-content-quality/spanish-prepositions-20260907/`
records exact IDs, token positions, before/after values, sources and backups.
Only the reviewed glosses and an appended review note change in authoring.
The established projector supplies runtime data. Sentences, token boundaries,
IDs, levels, playable flags, image queries and review/license status are retained.

The Spanish follow-up's 21 all-game readiness checks and seven contextual checks
pass. The first contextual run exposed an incorrect token position in the new
test's unchanged time-preposition example; correcting that test index resolved
the failure without a production change. Exact comparison verifies the 22 edits,
109 other protected paths, all 29 browser JSON files and 25 Android learning
catalogs. No APK was built.

## Mandarin function-word follow-up

A targeted AI self-review examined every standalone `在`, `的`, `会` and `给`
token in the 250-sentence Mandarin bank. Sixty hints in 59 records changed:

| Token | Corrections | Distinction |
| --- | ---: | --- |
| 在 | 36 | Location and scheduled time versus an ongoing action |
| 的 | 12 | Descriptions and an omitted noun versus possession |
| 会 | 5 | Expected actions and customary behavior versus learned ability |
| 给 | 7 | Giving versus recipient or beneficiary marking |

The grammatical distinctions follow Oxford CTCFL's
[Elementary Chinese Grammar](https://www.ctcfl.ox.ac.uk/media/pages/pdf/lang-work_grammar-database_grammar-database-for-hard-copy.pdf),
especially its descriptive/possessive particle, co-verb, progressive and location
sections, and the future/habitual uses in
[Cambridge's entry for will](https://dictionary.cambridge.org/dictionary/english-chinese-simplified/will).
The exact sentence-specific wording is this author's editorial decision.
Existing correct skill and possessive hints are retained.

Examples include `ww.family.grandfather-paper` (ongoing reading),
`ww.appointment.friday-three` (scheduled time), `ww.choice.red-one` (the red one),
`ww.reason.finish-help` (a conditional promise) and `ww.work.send-file` (recipient).
The authoring file and generated runtime keep all sentences, token positions,
playable flags and English concept links. Reading-guide generation updates only
the review note; all pinyin and reading units remain unchanged. Native approval
and pronunciation approval remain outstanding; the existing license status is
preserved. Verb Nebula and game code are unaffected.

Exact before/after values and backups are in
`artifacts/language-content-quality/mandarin-function-hints-20260907/`.
The actual providers pass all ten contextual checks across Mandarin, Spanish
and English. All modern authoring catalogs, runtime projections and generated
course views validate. This is self-review and source-delivery evidence, not
independent linguistic or audible review.

The final Mandarin delivery verification confirms all 29 browser JSONs and
25 Android learning catalogs against canonical data. The 108 other protected
paths are byte-identical, and full reading-guide comparison permits only the
appended review note. No pronunciation entry, game implementation or frozen
rubric changed in this batch.
