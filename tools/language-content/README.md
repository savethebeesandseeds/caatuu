# Language content contract

This tooling keeps semantic meaning and target-language wording on separate,
versioned boundaries:

- `apps/languages/shared/english-concepts/` owns stable concepts and the only
  text permitted to enter the English embedding model: `embeddingText`.
- a course's `content/` directory owns target text, pronunciation, authored
  word tokens, glosses, native review state, and content licensing state.
- the one-to-one concept ID join happens only after both catalogs validate.

The shared realization schema is language-neutral. Pronunciation is either
`null` where the selected course policy permits it or an object containing
`system`, `notation`, `languageTag`, and `reviewed`. The per-object `reviewed`
boolean must agree with the catalog-wide native-review state. Language-specific
rules are plug-in policies under `policies/`, selected by the catalog's
versioned `contentPolicy` ID. The Mandarin policy owns Hans, pinyin, and
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
catalog, the pronunciation-stripped learner realization, and a separate
browser-only pinyin preview from the explicit reading units. The guide remains
`machine-assisted-preview`; it does not satisfy the native-review or release
pronunciation gates.

The current starter catalog is a development draft because its Mandarin review
remains `native-review-required`. Its first-party English and Mandarin content
licenses are `release-cleared` under `AGPL-3.0-only`. Release validation must
continue to reject the unresolved native-review gate until a qualified
Mandarin reviewer records approval.

Run the checks in the established development container:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs
docker exec -w /workspace caatuu-dev node tools/language-content/project-word-world-runtime.mjs --check
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --check --manifest apps/languages/mandarin-simplified/static/setup-assets.json --launcher-static apps/launcher/static --language-static apps/languages/mandarin-simplified/static --shared-runtime apps/language-runtime --course-manifest apps/languages/mandarin-simplified/course.json --language-route-prefix /zh
docker exec -w /workspace caatuu-dev node --test tools/language-content/tests/content-contract.test.mjs tools/language-content/tests/word-world-projector.test.mjs tools/language-content/tests/mandarin-curriculum-quality.test.mjs
```

To intentionally refresh those projections after an authority change, run the
projector without `--check`, inspect the generated diff, then rerun the commands
above. The projector repairs derived output only; it does not rewrite either
authoring catalog.

The release gate is intentionally expected to fail only on native review for
the current draft:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release
```

This validator is read-only and never builds an embedding database.
