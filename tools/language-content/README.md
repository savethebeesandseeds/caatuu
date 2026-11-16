# Language content contract

All game learning records have authored usefulness and complexity (1–100) within the
four badge levels (0–3). The [progression guide](../../docs/CONTENT_PROGRESSION.md)
defines gradual introductions, evidence and spaced review. Run
`node tools/language-content/quality/content-progression-catalogs.mjs` in the
established container to validate metadata coverage across every registered
course, including nested forms/examples. This structural audit also runs in CI.

For new-language content, expansions or deeper inspection, see the
[manual learning evaluation tools](../learning-evaluation/README.md).
[Evaluator C](../learning-evaluation/content/README.md) inspects complete
metadata and a bounded English semantic sample for selected courses using
`--courses <id>`. The guide also identifies A for learner-state/Stats evidence
and B for sampling-policy experiments. These are optional manual diagnostics,
separate from structural validation and linguistic review.

Memory Moon is a playable game. Every registered course has
`static/data/games/memory-moon/content.json`, declared by
`resources.memoryMoonCatalog` and listed in `games`. Its shared v1 contract keeps target, learner-base
answer choices and English retrieval roles separate. Run
`node tools/language-content/validate-memory-moon.mjs --all`
in the established container for the complete inventory and structural checks.
See the [authoring guide](../../docs/MEMORY_MOON_CONTENT.md) for review status and
the content-only integration boundary.

Word World has one editable source per course:
`apps/languages/<course>/content/word-world/content.json`. Every source uses the
same record format and contains its English meaning, target sentence, word
hints, learner-base translation and review information together. See the
[catalog guide](../../docs/GAME_CONTENT_CATALOGS.md#word-world-one-editable-json-per-course)
for the four files and editing workflow.

`build-word-world-content.mjs --all` validates those sources and generates the
existing runtime and publication views. `--course <id>` selects one course;
`--check` reports drift without writing. New IDs can be added to one course
without adding them to the others. Shared IDs preserve their English meaning.
Language-specific review and token checks remain in place.

The build rejects sources with zero playable records, including in `--check`
mode. Sources mixing playable and untranslated records require explicit
`--allow-partial`; that replaces the published catalog with the playable subset.
Counts refer to playable records and report untranslated rows separately. A
failed empty build leaves existing runtime files unchanged, not synchronized or
withdrawn. See the [content authoring plan](../../docs/SEMANTIC_BANK_CONTENT_AUTHORING.md)
for batch review, language-specific requirements and publication order.

Sounds Quasar is a deterministic projection of those published sentences and
the playable Verb Lab pairs. Run the following in the managed container after
reviewing an intentional partial publication:

```sh
node tools/language-content/build-word-world-content.mjs --all --allow-partial
node tools/language-content/build-sound-quasar-content.mjs --all
node tools/language-packs/validate.mjs --sync-views
node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses
```

The listening builder refuses stale Word Net outputs and requires eight distinct
words and sentences in each difficulty band. It keeps source IDs, English audit
text, learner-base meanings, grades and explicitly authored Mandarin readings;
it never translates or infers pronunciation. Duplicate spoken sentences and
unsupported text lengths appear in its report. `--check` detects drift without
writing, and `--course <id>` selects one course. Device speech remains unreviewed.
Validate actual sessions with
`node --test tools/language-content/quality/game-readiness.test.mjs`.

Run `node tools/language-content/audit-semantic-bank-content.mjs` in the existing
container for a read-only inventory of all bank-derived course sources. It
checks stable IDs, retained English and grades, complete root-row coverage and
Grammar example references. It reports completed roots, untranslated roots,
nested examples/forms and bank SHA-256 values separately. These source counts
are not publication counts or a linguistic-quality certificate.

`apply-word-net-batch.mjs <batch.json> --check` validates an explicitly authored
modern-provider batch without applying it. `--apply` checks canonical `main`,
rechecks source and bank hashes, refuses conflicting completed rows, validates
the complete affected sources and writes an ignored receipt. It does not
generate translations or runtime catalogs. Czech bank records use their
separate versioned provider and authoring contract.

Record-based runtime formats use `publication.contract: "word-world-records-v1"`.
The declaration has exactly five fields:

```json
{
  "contract": "word-world-records-v1",
  "provider": "czech-standard-records-v1",
  "authoring": "apps/languages/czech/content/word-world/content.json",
  "runtime": "apps/languages/czech/static/data/games/word-world/content.json",
  "manifest": "apps/languages/czech/static/data/games/word-world/manifest.json"
}
```

The [record publication validator](lib/record-publication.mjs) confines those
paths to the owning course and requires the manifest to be its declared
`resources.wordWorldManifest`. The registered provider owns format and
language rules. The current `czech-standard-records-v1` adapter validates an
English-base/Czech-target standard corpus and its rubric; it is selected by
provider declaration rather than course ID. Validation reprojects the records,
content hash, counts and manifest references and compares the resulting runtime
bytes and manifest with the checked-in outputs. Existing compatible learner
content keeps its runtime representation while receiving full publication
validation. Adding another record format requires a registered provider.

The Czech bank-derived source now selects `czech-semantic-bank-records-v1`.
It has its own strict token/review contract and coverage policy; it does not
bypass the historical standard-corpus rubric or reuse historical approval
receipts. The provider migration alone does not publish its authored subset.

## Semantic banks

One semantic bank per authored game lives in
`apps/languages/shared/semantic-banks/`: `word-net.json`, `verb-lab.json`,
`memory-moon.json`, `conjugation-comet.json`, `grammar-gravity.json`,
`naturalization-nucleus.json`, and `case-cosmos.json`. Each row has a permanent
id, `sb.<game>.<six digits>`, plus the English line, one difficulty, and one
usefulness. Where stored grades differed, the bank keeps the pair that appears
on the most records. An equal count keeps the lower difficulty, then the higher
usefulness. Sounds Quasar has no semantic bank because its listening bank is
rebuilt from that course's Verb Lab pairs and Word World sentences. The course
content JSON remains the file the game reads. It is one `content.json` per
course per game, derived from that game's semantic bank. An empty target means
untranslated and is not playable. A translation is a later hand edit, and the
bank id is the key for the matching line. See
the
[catalog guide](../../docs/GAME_CONTENT_CATALOGS.md#semantic-banks).

The older files below are generated compatibility views, not editable sources.
They retain separate language roles for the existing publication contracts:

- `apps/languages/shared/english-concepts/` exposes stable concepts and the only
  text permitted to enter the English embedding model: `embeddingText`.
- a course's generated realization catalog exposes target text, pronunciation, authored
  word tokens, glosses, native review state, and content licensing state.
- the one-to-one concept ID join happens only after both catalogs validate.

The reusable language-role join makes a third boundary explicit for courses
whose learner base is not English. Such a course supplies a
`learner-base-realizations.v1` catalog with reviewed prompt text keyed by the
same concept IDs. English-base courses use `englishText` directly and must not
duplicate it in an overlay. `prepareLanguageRoleContent()` returns English
audit/retrieval, learner-base prompt, and target roles together while
`prepareEnglishRankingPayload()` makes learner-base and target text
unrepresentable in the embedding request. The optional public base projection
has its own narrow runtime contract and contains only concept IDs and reviewed
prompt text; no unrevealed language content is pre-authored by the framework.

Word World runtime projection is also split into a shared projector and a
target-specific projection policy. The shared code owns exact concept
coverage, English-only embedding invariants, confined outputs, target
realization projection, and manifest authority. The selected policy owns only
target-specific pronunciation exposure, supplementary aids such as Mandarin's
pinyin preview, their labels, and their validation. Adding a language therefore
extends the policy registry instead of adding target IDs, scripts, or rendering
branches to the shared projector.

The course manifest is the path authority for that projection. Its
`publication.runtimeProjection` names the exact policy, shared English output,
course-owned target output, optional course-owned learner-base output,
policy-defined supplemental outputs, and runtime manifest. The runtime
manifest must be the same file as `resources.wordWorldManifest`, and every
manifest reference must resolve exactly to its declared output rather than to
a guessed basename or directory convention. The projector and course validator
also resolve real paths, so links cannot move an authority or output outside
its allowed root.

Platform packaging must close over those exact outputs. Browser setup includes
the target, optional learner-base, supplemental, manifest, and shared English
concept URLs in its offline asset list. Android includes every course-scoped
runtime-projection output in the course asset catalog; the shared English
catalog remains a shared runtime URL rather than being relabeled as
course-owned content.

The shared realization schema is language-neutral. Pronunciation is either
`null` where the selected course policy permits it or an object containing
`system`, `notation`, `languageTag`, and `reviewed`. The per-object `reviewed`
boolean must agree with the catalog-wide native-review state. Language-specific
rules are plug-in policies under `word-world-projection/`, selected by the
catalog's versioned `contentPolicy` ID. The Mandarin policy owns Hans, pinyin, and
contextual polyphone safeguards; none are hardcoded into the shared validator.
The language-neutral token schema also permits optional `readingUnits`. The
Mandarin policy requires exactly one explicit contextual unit per Han
character and checks that those units compose to the authored token pinyin.
Other language policies remain free to omit the units or validate a different
pronunciation system; the shared contract does not apply Mandarin spacing or
punctuation rules to them.

Public browser data uses the distinct narrow schemas under
`apps/language-runtime/static/schemas/`. A draft runtime projection may omit
all unreviewed pronunciation while retaining authored word boundaries. It must
not claim the stricter authoring schema when fields were deliberately removed.
For Mandarin Word World, the deterministic projector writes the public English
catalog, the pronunciation-stripped target realization, and a separate
browser-only pinyin preview from the explicit reading units. The guide remains
`machine-assisted-preview`; it does not satisfy the native-review gate for
approved learner pronunciation.

Full dictionary content uses the same English-authority rule without becoming
the retrieval dictionary for every course. The dictionary audit loads the
course's catalog, core entries, and script lines, then presents each record
through the target adapter's `dictionary.presentEntry`. The resulting
`targetText` and `englishAuditText` must both be present, the adapter identity
must match the course target, and the audit text remains the English
meaning/audit value. Catalog metadata retains compatibility primary IDs in
`lookupLanguage` and `meaningLanguage`, but audit authority comes from the full
tags: `lookupLanguageTag` must exactly match the target locale and script, and
`meaningLanguageTag` must remain canonical English.

The courses are released and indexable. Pronunciation guides stay off.
First-party curriculum licenses for the identified courses are `release-cleared`
under `AGPL-3.0-only`. The project owner approved the original Spanish-course
and Norwegian curricula on 9 September 2026; see the
[approval receipt](../../docs/CURRICULUM_LICENSE_APPROVAL_20260909.json).
The 11 November 2026 approval does the same for Russian and Hebrew.

Run the checks in the established development container:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --all
docker exec -w /workspace caatuu-dev node tools/language-content/project-word-world-runtime.mjs --all --check
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check
docker exec -w /workspace caatuu-dev node --test tools/language-content/tests/*.test.mjs
```

Use `--course <id>` on either language-content CLI for a targeted catalog
check. The validator retains its no-selector single-pair compatibility mode
and explicit `--concepts` / `--realizations` inputs; its output labels that
mode so it cannot be mistaken for catalog-wide validation. The projector's
no-selector CLI mode selects all modern Word World publications, while the
single-policy `projectWordWorldRuntime()` API and `WORD_WORLD_PATHS` alias stay
available for existing programmatic callers.

To intentionally refresh those projections after an authority change, run the
projector without `--check`, inspect the generated diff, then rerun the commands
above. The projector CLI reads the unified per-course sources and repairs
generated publication/runtime views; it never rewrites the four authoring files.

Distribution validation checks release-cleared licensing. The no-selector
command checks the Mandarin compatibility target only; use `--all --release`
to check every modern course before distribution:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --all --release
```

Approved-pronunciation readiness is a separate optional check. It is not the
publication gate:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release --require-native-review
```

This validator is read-only and never builds an embedding database.
