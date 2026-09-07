# English listening pilot correction batch

Author: Codex `/root/android_all_courses`, 2026-09-07. This records authoring and
the subsequent independent AI text review by `web_all_courses`. Actual audible
and native review remain pending. It does not assign a quality score or claim
native-language, voice or device certification.

Authority: [Sounds catalog](../static/data/games/sound-quasar/content.json).
This revision contains 36 word items and 81 sentences. All 16 original verb
references and 16 original Word World references retain their IDs, targets,
meanings and English audit text. They are explicitly `graded: false`: available
for practice, excluded from objective coverage and transfer credit, including
when an older save contains successes. Authored listening material is defined
only in this catalog, without adding it to the Word World or verb banks.

The [fixed benchmark](../../../../docs/COURSE_CONTENT_QUALITY_BENCHMARK.md)
still has six listening objectives. This batch corrects 30 previously authored
sentences and adds 35; the existing 20 authored word items gain mandatory nearby
alternatives. Changed items increment their revision; new items start at 1.
The content revision is `sound-quasar-content-3`.

## Corrections and review scope

The independent review found that unrelated nouns or situations could identify
answers without attending to the taught sound or detail. It also found only two
new stress anchors, and that provisional starter examples could unlock graded
transfer. The correction addresses those findings as follows.

| Contrast group | Authored practice / transfer | Deliberate contrast |
| --- | --- | --- |
| `sentence-vowels` | 4 / 1 | Same `I saw the…` carrier with ship, sheep, chip and jeep; shop transfer |
| `sentence-consonants` | 4 / 1 | Same `I drew a…` carrier with cap, cab, cat and can; crab transfer |
| `sentence-stress` | 7 / 1 | Record, permit and object noun/verb pairs; present noun practice and verb-context transfer |
| `sentence-endings` | 7 / 1 | Present/past pairs for watch, play and want; wait practice and waited transfer |
| `sentence-plurals` | 7 / 1 | Singular/plural cup, dog and box pairs; bus practice and buses transfer |
| `sentence-agreement` | 7 / 1 | Neighbor/neighbors with walk, play and wash; plural close practice and singular closes transfer |
| `sentence-connected` | 7 / 1 | I'd/I'll, she's/she was, don't/didn't; they'll leave practice and they've left transfer |
| `sentence-intent` | 4 / 1 | Identical train carrier with close times; recombined 7:15 transfer |
| `sentence-intent-location` | 4 / 1 | Questions, affirmative/negative statements and kitchen/bedroom; affirmative bedroom transfer |
| `sentence-intent-tickets` | 4 / 1 | Same ticket request with quantity, day and time changes; three tickets on Friday morning transfer |

IDs use `es-en-sentence-<group>-<ordinal>`; prior authored IDs are retained.
The complete item and required-counterpart lists are in the authoritative JSON.
Every authored word and sentence requires one or two graded practice choices
from its own group. The selector includes them before random fillers; it cannot
remove a critical pair when choosing four options from a larger group. Transfer
items cannot appear as introductory distractors or required practice choices.

Stress remains recognition in grammatical context, not an isolated stress
perception test. Same-lemma alternatives are required where both forms are
practice items. The grammatical carrier also helps disambiguate the synthesized
reading, so a successful response alone is not proof of hearing stress.

Export was rejected as a fixed US noun/verb stress pair because Cambridge gives
a first-syllable US verb pronunciation as well as the noun pronunciation.
See [Cambridge export pronunciation](https://dictionary.cambridge.org/us/pronunciation/english/export).
Object has a documented noun/verb stress distinction in
[Merriam-Webster](https://www.merriam-webster.com/dictionary/object).
The other reference checks were [Cambridge permit](https://dictionary.cambridge.org/pronunciation/english/permit),
[Collins record](https://www.collinsdictionary.com/us/dictionary/english/record)
and [Cambridge present](https://dictionary.cambridge.org/us/dictionary/english/present).
These are text reference checks; no dictionary audio or application voice was
audibly evaluated during authoring.

## Independent editorial recheck

Reviewer `web_all_courses` read all 117 corrected catalog items on 2026-09-07:
36 words and 81 sentences, including the 85 authored items (20 words and 65
sentences) and the 32 retained source-linked items. The review covered targets,
Spanish meanings, English audit text, explanations, levels, reserved transfer
and group/choice ambiguity. It found no concrete translation, audit,
explanation or answer-ambiguity defect. This is text acceptance only; stress
still uses grammatical context as well as sound.

The authored provenance, all 85 authored item status mirrors and the 14 authored
contrast groups now record `ai-editorial-reviewed`, reviewer `web_all_courses`,
date `2026-09-07`. The eight legacy group statuses and all original source,
native, audio and license statuses remain unchanged. Only review metadata
changed after that independent reading; no targets or teaching text changed.

SHA-256 of the authoritative catalog after recording the review metadata:
`319f37fbcd2faabd3de717786f29a8ef6ec3565e077c11e9dede0f76250d4aaa`.
This identifies the bytes for this checkpoint, not future catalog revisions.

## Validation and unresolved evidence

[Focused content tests](../tests/sound-curriculum.test.mjs) exercise the actual
catalog and selector: fixed objectives, reserved text, ungraded legacy history,
fresh level selection, required contrasts across four/six-choice settings, and
specific plural, third-person, past, time, negation and quantity probes.
The shared helper/core/host tests own the general runtime contract.

Author validation on 2026-09-07: all five focused content tests passed in the
existing `caatuu-dev` container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/languages/english-from-spanish/tests/sound-curriculum.test.mjs
```

The five focused tests also pass after recording the independent review
metadata. Actual audible review must identify the voices/locales and inspect
the full contrasts, especially stress,
weak forms, word boundaries, US endings and close times. Browser and Android
asset delivery must be observed after integration. Successful schema checks,
speech API calls and this authoring record do not substitute for that evidence.
