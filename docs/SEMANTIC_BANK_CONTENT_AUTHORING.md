# Writing course content from the semantic banks

This replaces the proposed generic “fill the operating fields” workflow.
The English banks define meanings and grades. Writing a playable exercise also
requires decisions about the target language and the game's teaching task.
Codex authors and reviews those fields in small batches; a script does not
translate a gloss and infer the rest of the curriculum.

## Current catalogs

Mandarin is the only course whose playable content is derived from the
semantic banks. On 2026-11-16 the other courses' `content.json` files were
restored from `artifacts/content-json-2026-11-13` so those courses keep the
catalogs that were already playable. They are waiting to be reinstated to
this standard. Sounds Quasar has no copy in that snapshot; the non-Mandarin
listening catalogs stay at the last commit. Do not derive those courses
again until that reinstatement is intentional.

## Starting inventory

The inventory on 2026-11-13 found 51 course files containing 159,481 bank-derived
records. Every one was marked `untranslated`:

| Game | Bank rows | Course files | Course records |
| --- | ---: | ---: | ---: |
| Word Net | 9,002 | 10 | 90,020 |
| Verb Lab | 2,327 | 10 | 23,270 |
| Memory Moon | 603 | 10 | 6,030 |
| Grammar Gravity | 3,699 | 9 | 33,291 |
| Conjugation Comet | 581 | 9 | 5,229 |
| Naturalization Nucleus | 715 | 2 | 1,430 |
| Case Cosmos | 211 | 1 | 211 |

These are source records, not playable inventory. Some older generated Word Net
catalogs still contain their previous content. Source completeness and what is
currently served must be reported separately. Existing tests that load those
source files as populated fixtures already fail following the placeholder
migration; do not interpret them as a clean baseline.

The reader fixes now cover mixed-record Czech projection, an explicit Czech
semantic-bank provider, bank-reference retention through modern Word Net and
game consumers, authored-only exercise selection, strict Nucleus placeholders
and target-reading provenance, and an explicit Word Net publication policy.
The content inspector also handles unfinished structural records without
crashing or counting them as playable. See the authoring checkpoint below for
actual progress; the initial all-untranslated inventory is historical.

## Authority and authoring method

- Work in the canonical checkout on `main`, using the existing `caatuu-dev`
  container for validators. Preserve concurrent edits. No release is part of
  this work.
- Keep all seven bank files byte-for-byte unchanged. Preserve existing course
  IDs, bank references, English, difficulty and usefulness. Do not rerun the
  placeholder derivation over authored records.
- Read current course files and their actual validators. The old
  `artifacts/content-json-2026-11-13/` directory is only a schema checklist;
  do not retrieve translations, IDs or grades from it. Historical generated
  catalogs are not replacement authoring authorities.
- Codex writes translations, contextual hints and exercises directly from the
  bank meaning, following the course variety. There is no configured automatic
  English-to-target translation service. Do not invoke the Czech-to-English
  phone model for this job.
- Review the entire exercise before promotion: meaning, natural target text,
  learner-base text, contextual hints, reading, and every proposed answer.
  Automated checks supplement this review. Keep the existing honest
  machine-assisted/native-review-required metadata; never claim native review.
- A batch that cannot meet a game's catalog floors stays a candidate in ignored
  `artifacts/content-authoring/`. The live placeholder stays `untranslated`.
  The course's existing `content.json` remains its only editable runtime source.

For each batch, keep an ignored ledger containing course/game, stable record
and bank IDs, source English and grades, source-file SHA-256, authoring-policy
version, reviewed candidate fields, check results, and unresolved issues. Check
the live source again before applying a candidate. A changed English meaning,
language policy or relevant live record invalidates that candidate. An unchanged
completed record is left alone. Do not skip a stale translation merely because
its target field is nonempty, and do not overwrite another session's edits.

English is the meaning/audit role in every course. For `es-en`, it is also the
target: write Spanish learner-base prompts and hints. Other courses translate
the English into their target language. Labels remain labels, including tense,
voice, script names and deliberately multi-sense glosses.

## Rules by game

### Word Net

Start with a small Spanish batch of useful everyday sentences covering a short
formula, a question, negation, a preposition and an inflected verb. Validate
translation and contextual hints together. Then check a small `es-en` batch to
exercise the reversed learner-base direction before expanding to other courses.

Modern providers require tokens with `surface`, `pronunciation`, nonempty
`gloss`, and `playable`, plus policy-specific `readingUnits` where required.
They do not accept the Czech provider's `normalized` and `tokenIndex` fields.
Token surfaces must reconstruct the sentence under the validator's punctuation
and whitespace normalization; punctuation need not become a separate token.
Hints describe the actual contextual meaning, including multiword expressions.
An uncertain hint requires correction, not a null gloss on modern providers.

Keep English-only embedding text and existing source metadata. Use null
pronunciation only where the course policy permits it. Authored Mandarin
readings remain separate presentation metadata and still need to be supplied.

Czech uses a separate publication contract. Its old standard provider requires
its own IDs, CEFR, learning/grammar/provenance/review objects and corpus rubric.
Adding `semanticBankId` does not exempt old standard records from those
requirements. The implemented `czech-semantic-bank-records-v 1` provider owns
the new bank format: exact Czech tokens and contextual glosses, explicit AI
review, English-only ranking, runtime compatibility, retained bank references
and publication coverage checks. It is selected in the Czech source declaration;
the old provider remains intact. Selecting it does not publish the new corpus.

### Verb Lab

Write the empty language side, preserving the bank's intended sense and any
tense, voice, multiword expression or script label. The current derivation
stamped every row `kind: "verb"`; check the reader's accepted kinds and the
item's teaching role before retaining that value. A script name or nonverb
gloss is not made into a verb merely to satisfy the initial placeholder.
For `es-en`, Spanish belongs in `source` and bank English in `target`.

### Memory Moon

Author exactly one defensible answer and two clearly incorrect alternatives
in the learner's base language. A nearby bank sentence is only a candidate
alternative. Synonyms such as “Mom is at home” and “Mother is at home” cannot
serve as wrong answers to one another; more specific compatible statements
also need semantic review. Use a real contrast in location, number, polarity
or another declared focus, and explain what makes each alternative wrong.

Validate the target script, English audit, focus, stable choice IDs, reading
and complete difficulty-band floor before promoting the batch. Mandarin pinyin
must be authored with the sentence's contextual readings. The existing
`memory-moon-reading` helper validates that annotation; it cannot generate it.

### Grammar Gravity

Choose a contrast supported by the course's declared grammatical axes first.
Author the forms and examples from that contrast, not from an English string
diff. English singular/plural or gender substitutions do not establish a valid
target-language slot or an anchor.

For each group, designate one existing bank-derived course record as the
challenge owner and retain its ID and root bank reference. Give forms and
examples stable subordinate IDs and revisions. Each example also names its
own bank row. Keep other source rows as untranslated placeholders until they
have a distinct teaching use; do not silently delete or renumber them to form
groups. Track group membership in the batch ledger to avoid duplicate lessons.
Add narrowly validated root/example bank-reference support to the reader with
the first actual group, rather than accepting arbitrary extra fields.

Check all declared forms, two examples per form, exact slot reconstruction,
whole-token anchors outside the slot, learner-base meaning, and catalog floors
including difficulties 1, 2 and 3. The course-owned noun catalog stays separate.

### Conjugation Comet

Keep the meaning's tense, aspect and voice. A bank label such as “ask (past)”
or “place (present passive)” cannot become a generic present-tense exercise.
Write complete, language-appropriate families, stable form IDs/revisions,
learner cues, accepted forms and phrase frames; validate the resulting rounds.

For Bokmål, follow the existing infinitive/present/preterite/present-perfect
policy. Changing “I” to “she” does not change its finite verb. Syncretic forms
are a linguistic property, not evidence that the translation failed. Use the
reader's supported contrasts and answer-equivalence behavior. Do not invent
different spellings or require every person form to differ.

### Naturalization Nucleus

Separate Arabic word readings from Mandarin single-character readings. A short
English gloss does not guarantee that its natural Mandarin translation is one
character. Author only genuine character/meaning matches with a natural
context, contextual pinyin and tone. Leave sentence-shaped or unsuitable rows
untranslated; never truncate a translated word to one character.

Arabic needs authored vowel-marked words before `arabicReadingUnits` can derive
their supported romanization. It does not infer missing lexical vowels.
Mandarin pinyin/tone must be authored; existing preview helpers consume it.

The derived Mandarin placeholders have Arabic-shaped fields. The validator now
distinguishes strict untranslated bank placeholders from complete v 1 Mandarin
and v 2 Arabic items. It accepts the retained course IDs
(`zh.naturalization-nucleus.*` or `ar.naturalization-nucleus.*`) with exact
course and bank-suffix checks, alongside existing legacy IDs. Malformed or
partly populated placeholders are rejected rather than silently discarded.

Use bank IDs to trace English meanings. Reading/context provenance must name
the actual authored context source; an English bank row is not proof of a
target-language reading. Verify real references rather than populating source
arrays with an unrelated ID just to make validation pass.

### Case Cosmos

Author from Czech lemma, number, declension and the actual governing Czech
construction. “Location” in English does not uniquely imply locative; the
chosen Czech preposition and verb determine the case. Do not generate noun
paradigms by translating modified English prepositional frames.

Supply genuine paradigms, accepted variants, practice/transfer assignments,
objective IDs and explanations. Keep dog and kitten on their separate bank
grades. Verify that the target form occurs once as a whole word and that every
objective has its required practice and transfer coverage. Add only the
necessary bank/grade fields to the context contract, backed by real fixtures.

## Validation and publication order

1. Author a bounded candidate batch and review its language and teaching logic.
2. Check bank/source identity, grades, tokens, readings, answers and game floors
   using the real provider/game validator. Add regression fixtures for each
   newly supported reader shape before writing that shape into a live course.
3. Inspect all learner-visible fields for child suitability. The existing
   safety scanner has English/Czech rules; a pass is not a multilingual safety
   or translation-quality certificate. Review the target and learner-base text
   explicitly as part of authoring.
4. Recheck live source hashes and apply only the completed batch. Do not claim
   native review, change bank grades or regenerate untouched records.
5. For Word Net, run the build in `--check` mode before generating outputs.
   The default rejects any untranslated rows. `--allow-partial` explicitly
   means replacing the existing runtime with the playable subset; it is not
   an append operation. Do not use it to publish a tiny authoring pilot.
6. Build only the selected ready course, refresh its existing setup metadata,
   then verify the generated runtime and offline references. A later correction
   or demotion requires regeneration and another check before claiming it is
   absent from play. Never publish first and scan afterward.

Zero playable records is an error even with `--allow-partial` or `--check`.
The builder preserves old files and explicitly reports that they are **not
synchronized**. It does not implement course withdrawal. If the final playable
record must be removed, resolve the runtime's empty-catalog/disabled-game
behavior explicitly; do not report a successful retraction while old content
remains served.

Run the relevant content inspection from the
[evaluation guide](../tools/learning-evaluation/README.md) after a substantive
batch. It measures inventory and consistency; linguistic review remains part
of authoring. Report authored, untranslated, published and blocked counts
separately. Completion means validated, reviewed exercises under the course's
actual rules, not merely nonempty target fields.

## Next writing sequence

1. Spanish Word Net candidate batch and `es-en` direction check.
2. Small Verb Lab batches grouped by meaning type and course, then expansion
   after reading the complete pairs in context.
3. Memory Moon with reviewed distractors and authored readings.
4. Course-specific Grammar and Conjugation batches; preserve source semantics
   and establish stable nested IDs before expansion.
5. Mandarin/Arabic Nucleus and Czech Case Cosmos after their strict reader
   support and genuine linguistic fixtures are in place.
6. Czech Word Net after its separate provider migration is implemented and
   tested. No blanket bypass of the existing corpus validator.

This sequence describes the order used for the current authoring batches.
Passing source checks does not establish complete multilingual content or
publication readiness.

## Preparation validation

After the Docker Desktop restart, the existing `caatuu-dev` container was started
and its canonical workspace mount verified. All eight focused regressions passed:
two Czech projection tests, five Word Net publication tests and one conjugation
bank-reference test. The documentation-link check passed for 213 files, the
repository file-policy check passed for 3,302 tracked/candidate files, and the
seven semantic banks retained their original SHA-256 hashes.

The earlier broad tests that assume populated live catalogs still require
attention as those catalogs are authored. This focused result validates the
preparation fixes, not the unfinished course inventory. Reproduction commands:

```powershell
docker exec -w /workspace caatuu-dev node --test tools/language-content/tests/standard-corpus-projection.test.mjs tools/language-content/tests/word-world-publication-readiness.test.mjs
docker exec -w /workspace caatuu-dev node --test --test-name-pattern="playable conjugation records retain" apps/language-runtime/tests/shared-conjugation-comet.test.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
```

Do not run them on Windows or recreate the development container as a workaround.

## Initial authoring checkpoint — 2026-11-13

The preparation and reader fixes are implemented. Content authoring is still
partial: **2,942 of 159,481 root source records are authored; 156,539 remain
explicitly untranslated.** Every one of the 51 source files now has an authored
batch. These counts do not mean the full course-writing task is complete.

| Course | Word Net | Verb Lab | Memory | Grammar groups | Conjugation families | Nucleus | Case |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Czech | 35 | 141 | 33 | 4 | 33 | — | 211 |
| Mandarin | 58 | 92 | 24 | — | — | 36 | — |
| Spanish | 90 | 114 | 28 | 5 | 40 | — | — |
| English from Spanish | 90 | 114 | 28 | 6 | 40 | — | — |
| Bokmål | 35 | 141 | 33 | 4 | 165 | — | — |
| Arabic | 68 | 92 | 24 | 5 | 16 | 36 | — |
| Latin | 35 | 141 | 33 | 4 | 33 | — | — |
| Georgian | 35 | 92 | 24 | 5 | 16 | — | — |
| Russian | 106 | 176 | 24 | 4 | 32 | — | — |
| Hebrew | 106 | 175 | 24 | 4 | 32 | — | — |

The authored families also contain 2,146 conjugation forms and 250 grammar
examples. Those nested teaching records are additional counting units, not
additional completed root rows. Czech Case Cosmos is fully authored at 211/211;
the other banks remain incomplete. Grammar example references can cover source
meanings whose independent owner rows remain untranslated, as specified above.

All seven banks retain their starting SHA-256 values. The source audit checks
every root ID, English meaning, difficulty and usefulness against its bank,
and checks grammar examples against their own source meanings and grades.
Each source SHA-256 is captured so later changes can be distinguished from this
checkpoint. Run it again rather than treating this table as a live counter:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/audit-semantic-bank-content.mjs --summary
```

The final integration check passed all 51 source contracts and metadata audits.
It constructed every authored conjugation helix and found a correct rotation,
verified four distinct meaning choices per conjugation band, eight Verb Lab
pairs per band, six Memory questions per band, and real Grammar/Case rounds at
every offered difficulty. Both reading courses have nine Nucleus items per
band, backed by their actual authored Word Net occurrences. Word Net candidates
passed their course providers; they were not counted as newly published content.

The focused reader, publication, source-audit and content-inspector regressions
passed (76 tests). Final ignored evidence is retained at
`artifacts/content-authoring/validated-source-status-1794569638662.json` and
`artifacts/learning-evaluation/content/20261113-all-authored-03/`.
The latter has exactly ten adapter failures, all from the historical Word Net
runtime/source mismatch; every other game adapter succeeds. Its 27,020 known
playable assessment units include pre-existing noun and listening catalogs and
must not be represented as newly authored records. No semantic-model evaluation
was run. Reproduce the metadata inspection with a fresh output directory:

```powershell
docker exec -w /workspace caatuu-dev node tools/learning-evaluation/content/run.mjs --no-semantic --output artifacts/learning-evaluation/content/<fresh-run-name>
```

AI peer reviews corrected a Hebrew vowel-pointing omission, narrowed Bokmål
“walk” to `gå til fots`, preserved exact nested source complexity, and scoped
the English agreement explanation to the displayed noun subjects. Mandarin
readings follow the course's citation-tone policy for 一 and 不, with contextual
polyphones and authored neutral syllables. No native approval is claimed.
The integration pass also found and supplied missing beginner Grammar groups
in Arabic and Georgian; an all-course regression now checks every offered band.

Word Net runtime catalogs were not regenerated. Their previous inventories
remain in place, and evaluator C reports their source/runtime identity drift
explicitly. A partial build would replace those catalogs rather than append
these batches. No release, APK, commit or branch was created by this work.

Remaining work is substantial: expand and review the pending course records,
write suitable new grammar groups instead of promoting examples mechanically,
resolve inapplicable or flawed bank meanings explicitly, then publish selected
ready Word Net courses with verified generated outputs and setup metadata.
Do not mark a record complete because it has English, a target string, or an
automated validator pass alone.

## Stability integration — 2026-11-13

This later checkpoint supersedes the initial publication status above. All ten
Word Net runtime catalogs now contain the selected authored records; Sounds
Quasar is regenerated from those sentences and the authored Verb Lab pairs.
There are **3,486 authored root records and 155,995 untranslated records** across
the 51 sources. Untranslated records remain excluded from play. All seven
semantic banks retain their original bytes, IDs, English and grades.

Published Word Net contains **1,156 sentences**: Czech 96, Mandarin 118,
Spanish 110, English-from-Spanish 110, Bokmål 96, Arabic 128, Latin 96, Georgian 102,
Russian 150 and Hebrew 150. Each course has at least 24 sentences in each band.
Listening contains 1,278 vocabulary items and 1,154 sentences; two duplicate
spoken sentences are deliberately excluded and reported by the builder.
Every course has 12 beginner Memory questions for two disjoint six-item sessions.
The other authored-game counts and nested form/example counts above are unchanged.

Integration fixed pending-record handling in English audits, dictionary
presentation and the release content scanner. Completed rows remain strictly
validated. The scanner retains unfinished Memory records' English audit and
now scans canonical vocabulary target/source/audit fields. Release preflight
uses `--all --release`; both Word Net compatibility projectors accept explicit
`--allow-partial` without relaxing their default refusal of mixed sources.
All ten offline setup manifests have been refreshed.

Ignored evidence:

- `artifacts/content-authoring/validated-source-status-1794571595942.json`:
  all 51 source contracts, metadata and bank joins pass.
- `artifacts/content-authoring/stability-game-readiness-final.log`: 82 tests
  pass, including all 61 enabled course/game combinations at levels 0–3 and
  every offered board size and choice count.
- `artifacts/content-authoring/stability-sounds-focused-final.log`: 178 tests pass.
- `artifacts/content-authoring/stability-learner-safety-tests.log`: 29 tests pass;
  the Android-wide scanner in `stability-learner-safety.log` also passes.
- `artifacts/learning-evaluation/content/20261113-stability-integrated-01/`:
  all 70 adapters succeed, including all Word Net source/runtime joins. Its
  10,409 assessment units include nested forms and pre-existing noun catalogs;
  they are not newly authored root records. Semantic-model inspection was not run.

Native linguistic review and completion of the full banks remain outstanding.
No APK build, publication, commit or branch is implied by these source checks.
