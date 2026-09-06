# Spanish to English implementation

Add a Spanish-base course through the canonical shared Caatuu application.
The initial course is `es-en` at `/es-en/`, with learner base/interface `es-ES`,
target and speech locale `en-US`, and invariant English audit/retrieval `en`.
It begins as a browser-enabled local development preview. Pages and Android
distribution remain disabled while review and release gates are pending.

## Delivery plan

- [x] Translate the complete shared interface message API into Spanish.
- [x] Add the English adapter, authored content and projection policies.
- [x] Add Spanish learner-base sentences and target-bound word meanings.
- [x] Supply English Word World, Conjugation Comet, Grammar Gravity and
  Sounds Quasar data with Spanish learner-facing prompts and copy.
- [x] Formalize Sounds Quasar learner-base identity and presentation.
- [x] Register the directional course and localize the launcher selection.
- [x] Generate profiles, runtime projections and complete offline assets.
- [x] Run focused regression checks, then inspect desktop/mobile browser flows.

## Completion checks

Spanish UI strings must retain the English message IDs, kinds and placeholders.
Learner prompts and word meanings must be Spanish; target speech must be
English. English audit data remains independently inspectable and is the only
retrieval input. Course progress and caches must not overlap existing courses.
Local draft support must never imply native review or release clearance.

Implementation and validation use `C:\Work\caatuu` on `main` and the existing
`caatuu-dev` container. Concurrent edits are preserved; shared generators run
after their relevant inputs are ready. No external publication is part of this
goal. See the [language pack workflow](../tools/language-packs/README.md).

## Validation checkpoint — 2026-09-06

The combined interface, English policy, and Sounds Quasar suite passed all 118
checks. Launcher, selector, and profile checks passed 14/14. The learner-base
authoring, projection, and provider checks passed 36/36, and renderer checks
passed 7/7. Course-content checks passed 6/6, including contextual Spanish hints.
All four browser setup manifests were refreshed successfully.

The live browser confirmed Spanish launcher selection, entry into `/es-en/`,
Spanish course setup and navigation, and Word World with Spanish sentence
prompts and word meanings beside English answer choices. No browser errors
were reported in those flows.

After Docker recovery, the course-contract and content suite passed 47/47.
The read-only projection check confirmed all 250 records are current, and the
generated launcher and course profiles match their manifests. The final grammar
accessibility update passed 53/53 focused checks, and all 7 Word World renderer
checks passed again against the current shared source. Offline manifests were
refreshed for the final shared-module revisions and content hashes.

Browser verification covered all four games: Spanish prompts, Spanish feedback,
English forms and answer choices, and Spanish listening meanings. Grammar
iframe accessibility labels now use Spanish as well. At a 390-pixel viewport,
the Spanish launcher and sentence-listening screen fit without horizontal
overflow; switching the launcher between English and Spanish selects the
correct course family and browser entry. The temporary viewport was reset.

Repository organization passed for 2,537 tracked and candidate files, and
Markdown links passed for 153 files. Work remains in the canonical checkout on
`main`, with only `origin/main` as a remote-tracking branch. The established
server is available on port `8765`. These checks established course integration,
but did not establish parity with the newest Grammar Gravity interaction. The
user subsequently identified the older matching board in English; the follow-up
below closes that gap. Native-language review, license clearance, and external
release remain separate publication gates.

## Follow-up plan: one modern Grammar Gravity game

Status: implemented. All three courses use the same explicit modern sequence.
The matching board, pair controller, legacy animation modes, and Czech raw-array
adapter have been removed. Future courses must pass the modern content contract.

### Intended interaction

Keep the current animated sequence and its controls, feedback, accessibility,
and standalone noun practice. Each course explicitly declares the applicable
stages: meaning, grammatical category, and completing an authored phrase.
Czech and Spanish use their grammatical gender/number categories and adjective
or determiner forms. English uses number and determiner or subject-verb agreement. English
adjectives must not receive invented gender/number endings.

An English example is `books` -> `libros` -> plural -> `these books`.
Determiner choices stay within an unambiguous family such as `this/these`, or
provide an explicit near/far cue. Verb questions preserve their authored subject
and tense context: `The dogs ___ quiet.` -> `are`.

### Implementation order

1. Define one explicit modern exercise contract. Author the noun/subject anchor,
   its learner-base meaning, grammatical category, complete target phrase,
   replaceable phrase slot, correct form, and distinct answer choices. Declare
   applicable stages directly. Do not infer them from missing data, relabel
   determiners/verbs as adjectives, or derive a noun by deleting a verb from a
   sentence. Keep Spanish presentation separate from English audit fields.
2. Generalize the current animated controller's adjective/gender assumptions to
   the declared category and phrase-slot stages. Preserve the current visual
   interaction and its intentionally selectable practice modes.
3. Migrate Czech, Spanish, and English content to this contract together.
   Preserve the existing English demonstrative and subject-agreement families,
   add their explicit anchors/meanings/slots, and verify each answer is unique.
   Include Spanish's determiner challenges, which the current adjective-only
   journey builder silently skips. Convert Czech's legacy source-array format
   before removing its runtime adapter, preserving its 18 challenges, 162 phrase
   examples, stable normalized IDs, and exact text/review metadata.
4. Delete the matching board's markup, styling, pair-selection controller, and
   fallback round selection. Delete the animation controller's `legacy` mode
   and defaults. Remove obsolete data adapters, tests, and assets once all
   current course references use the modern contract. Do not leave hidden or
   disabled copies that can be selected later.
5. Enforce the modern contract in course-onboarding validation. Every enabled
   Grammar Gravity course must supply valid exercises at its offered levels.
   Unknown stages, missing required meanings/slots, ambiguous choices, or old
   formats fail validation before the course can expose the game. Runtime
   validation reports invalid content without selecting another renderer or
   silently substituting noun practice for a broken sequence.

Redirect-only old URLs may continue pointing to the current game; they contain
no legacy renderer. Czech's unrelated publication exception is outside this
gameplay migration.

### Acceptance checks

- No supported course or malformed fixture can render the old matching board
  or enter a legacy animation mode.
- Czech and Spanish retain their modern sequence and current game controls.
- English plays the same modern interaction with Spanish meanings, number
  categories, and correct English determiner/verb forms.
- A synthetic future language exercises the declared-stage contract; incomplete
  or unsupported declarations fail validation instead of activating a fallback.
- Behavioral tests verify the rendered stages, not merely valid content or
  successful mounting. Browser checks cover all three target languages and
  desktop/mobile layouts; shared offline asset revisions and hashes are refreshed.

### Implementation checkpoint — 2026-09-06

All 250 existing examples are preserved with stable IDs and exact original
phrases: Czech 162, Spanish 64, and English 24. Every eligible example now
produces a modern round, including all Spanish determiner families. The
strict v3 validator rejects old formats, missing stages and invalid slots;
onboarding also checks that category labels and images match the noun catalog.

The combined focused suite passed 156/156 checks. Coverage includes actual rendered stages for all
three courses, sentence frames, learner/audit separation, scoring, speech,
keyboard focus, retries, infinite time, hidden-page suspension, content errors,
explicit noun startup, and immutable round-bank rollover. Onboarding, shell,
generated-view and package-closure checks pass. Canonical validation passes for all four
course packs. All four offline manifests and worker revisions were refreshed.

The live browser confirmed the modern sequence in Czech, Spanish and English.
English used Spanish meanings, singular/plural categories, and authored
determiner and verb slots. At 390 pixels, both the result card and the complete
verb question (`The shops ___ open.` / `were`) fit the mobile viewport.
The original English difficulty was restored after testing.

Repository organization passed for 2,539 tracked/candidate files; Markdown
links passed for 153 files. Work stays in the canonical checkout on `main`;
the only remote-tracking branch is `origin/main`. Concurrent game changes were
preserved. Native review, license clearance and publication gates are unchanged.
