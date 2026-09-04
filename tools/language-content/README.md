# Language content contract

This tooling keeps semantic meaning and target-language wording on separate,
versioned boundaries:

- `apps/languages/shared/english-concepts/` owns stable concepts and the only
  text permitted to enter the English embedding model: `embeddingText`.
- a course's `content/` directory owns target text, pronunciation, authored
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

The Mandarin starter catalog is a development draft because its native review
remains `native-review-required`. Its first-party English and Mandarin content
licenses are `release-cleared` under `AGPL-3.0-only`, so pending native review is
an explicit quality disclosure rather than an APK publication veto. The Spanish
starter catalog separately remains both `native-review-required` and
`release-review-required`; it is valid for local development but must not be
promoted or distributed until both gates are deliberately cleared.

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
above. The projector repairs derived output only; it does not rewrite either
authoring catalog.

Distribution validation checks release-cleared licensing. The default Mandarin
compatibility target passes; Spanish intentionally fails that check until its
license review is recorded:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --course es --release
```

Activation and approved-pronunciation readiness are a separate, intentionally
stricter check that continues to fail for either development course while native
review is pending:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release --require-native-review
```

This validator is read-only and never builds an embedding database.
