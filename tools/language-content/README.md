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

Public browser data uses the distinct narrow schemas under
`apps/language-runtime/static/schemas/`. A draft runtime projection may omit
all unreviewed pronunciation while retaining authored word boundaries. It must
not claim the stricter authoring schema when fields were deliberately removed.

The current starter catalog is a development draft. Development validation
accepts its explicit `native-review-required` and `release-review-required`
states. Release validation rejects either unresolved gate and must continue to
do so until real reviewer and licensing records replace those states.

Run the checks in the established development container:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs
docker exec -w /workspace caatuu-dev node --test tools/language-content/tests/content-contract.test.mjs
```

The release gate is intentionally expected to fail for the current draft:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --release
```

This validator is read-only and never builds an embedding database.
