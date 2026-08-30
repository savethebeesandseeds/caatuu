# Caatuu semantic-index foundation

`caatuu-semantic-index` is the language-neutral contract for Caatuu's local
semantic indexes. It fixes the retrieval boundary before more course packs are
added:

- curriculum vectors are produced from reviewed `english_text` only;
- visual-asset vectors are produced from manual English descriptions only;
- target-language text, pronunciation, linguistic metadata, and review
  metadata live in a separate `target_realizations` overlay;
- stable concept IDs join an English semantic document to any number of course
  realizations;
- each course config owns its output root, public route, and compatibility
  filename without changing the shared model contract.

The executable contract is in `src/contract.mjs`. The normalized config shape
is documented by `semantic-index-config.schema.json`.

## Configuring a course

Use `defineSemanticIndexConfig` rather than copying Czech constants. A future
Mandarin pack can declare `zh-Hans`, its target text and generic
`pronunciation` metadata fields, and `/zh/data/embeddings` while using the
same `english_text_only` policy. Mandarin-specific pinyin and polyphone-safe
authoring rules live in its separately selected content policy, not this
semantic-index contract:

```js
const config = defineSemanticIndexConfig({
  indexId: "zh-curriculum-v1",
  courseId: "zh",
  target: {
    locale: "zh-Hans",
    textField: "target_text",
    pronunciationField: "pronunciation",
  },
  record: {
    idField: "id",
    semanticMetadataFields: ["topic", "difficulty"],
    linguisticMetadataFields: ["token_spans"],
    reviewMetadataFields: ["reviewed_by", "reviewed_at"],
  },
  storage: {
    repositoryRoot: "apps/languages/mandarin-simplified/static/data/embeddings",
    routeRoot: "/zh/data/embeddings",
    manifestUrlRoot: "data/embeddings",
    databaseFile: "caatuu-zh-curriculum.sqlite",
  },
});
```

The current `zh` development slice does not publish a course-specific
SQLite index. Its browser catalog selects the centrally owned
`all-minilm-l6-v2-qint8-v0.1` runtime from
`apps/language-runtime/embedding-runtimes.json`, embeds only shared English
concept text on demand, and joins results to authored Mandarin realizations
after ranking. The config above describes the generic offline-index path when a
future reviewed course actually needs one.

`prepareSemanticCurriculumRecord` returns two deliberately separate values:
an English embedding document and a target realization. It rejects missing
English anchors, target fields configured as embedding inputs, target fields
leaking into semantic metadata, duplicate stable IDs, and unsafe paths. The
builder boundary also mechanically requires normalized ASCII-Latin authored
text, rejects non-Latin or non-ASCII letters, combining marks, and non-ASCII
numerals (and any other non-ASCII character), requires at least one Latin
letter, and rejects an embedding string that normalizes to the same value as a
target-owned string. These checks stop Han, Cyrillic, accented target text, and
direct target copies even when a caller mislabels them as `english_text`.

The mechanical script gate is deliberately not presented as language
detection: plain unaccented Latin text can belong to many languages. English
identity remains an authoring and provenance contract, enforced by the
course's English concept catalog and the fixed `en` / `english_text` /
`english_text_only` semantic config. The builder independently verifies that
config before preparing a record; script leakage is the fail-closed mechanical
backstop.

## Czech compatibility and migration

`configs/czech-compat.mjs` preserves the established Czech locations and
filename:

```text
apps/languages/czech/static/data/embeddings/<model>/caatuu-cz-curriculum.sqlite
/cz/data/embeddings/<model>/caatuu-cz-curriculum.sqlite
```

Current browser, Android, and server consumers still require the published
schema identity `caatuu-cz-vector-db` version 1. The compatibility config keeps
that identity while newly built schema metadata also advertises the generic
`caatuu-semantic-index` contract. This is intentional: consumers can migrate
to the generic name before a later release changes the published identity.

The existing command remains authoritative:

```text
cd /workspace/tools/czech-ml
npm run build:vector-db
```

The tracked Czech SQLite database and manifest are not rebuilt as part of this
foundation change. On the next deliberate rebuild, Czech target text is
written to `target_realizations` and no longer copied into the English
embedding document metadata. The database path, model ID, setup URLs, and
catalog command remain compatible.

Run the focused contract tests in the repository container:

```text
docker exec -w /workspace/tools/semantic-index caatuu-dev npm test
```
