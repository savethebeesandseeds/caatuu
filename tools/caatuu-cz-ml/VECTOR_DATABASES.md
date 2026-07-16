# Caatuu CZ Vector Databases

This is the local-first vector database plan for the Czech app only.

## Goal

Use one SQLite schema across:

- server/container runtime
- browser PWA
- Android app

The repo should keep the curated curriculum data useful to other people. The
current SQLite vector index is tracked alongside the JSONL corpus. The Android
APK stays light: it downloads the SQLite DB, ONNX model, and ONNX Runtime WASM
after install instead of bundling them. Heavy runtime artifacts stay outside Git
unless we explicitly decide otherwise.

## Canonical Schema

The source of truth is:

```text
tools/caatuu-cz-ml/vector-schema.sql
```

The current generated embedding model is:

```text
all-minilm-l6-v2-qint8-v0.1
```

Current fixed assumptions:

- source model: `sentence-transformers/all-MiniLM-L6-v2`
- source revision: `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`
- model id: `all-minilm-l6-v2-qint8-v0.1`
- ONNX file: `model_qint8_arm64.onnx`
- dimensions: `384`
- max tokens: `256`
- pooling: `mean`
- vectors: normalized `float32le`
- vector input: English sentence text only (`english_text`)
- manifest/schema rule: `embedding_text_field = english_text` and
  `embedding_input_policy = english_text_only`
- distance: cosine similarity
- license: Apache-2.0

Curriculum metadata such as topic, target words, grammar tags, difficulty, and
age band is stored in SQLite JSON fields for filtering and review. It is not
embedded into the vector.

Manual image asset descriptions use the same semantic model. Those rows are
stored as `source_kind = image_asset` or `source_kind = macaw_action_asset`
documents and are referenced through separate lookup tables:

```text
asset_embedding_refs
macaw_action_embedding_refs
```

The asset vectors are computed from manually written English descriptions only,
not from pixels. The app-facing keymap for the current miscellaneous assets is:

```text
apps/caatuu-unified/static/assets/miscellaneous/keymap.json
```

The app-facing keymap for the current macaw action assets is:

```text
apps/caatuu-unified/static/assets/macaw/actions/keymaps.json
```

Keep those keymaps human-curated. The database rebuild can ingest them, but it
must not generate image descriptions automatically.

The old `caatuu-local-hash-v0.1` database remains a rollback/debug artifact.
Never compare its vectors with MiniLM query vectors.

## Runtime Shape

The generated database should be published under:

```text
apps/caatuu-czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite
```

This current SQLite database is a tracked curated-data artifact.

The matching tracked manifest should be updated at:

```text
apps/caatuu-czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json
```

The embedding artifact is also exposed through a small catalog:

```text
apps/caatuu-czech/static/data/embeddings/models.json
```

Keep this catalog in sync with the manifest. It is intentionally separate from
`static/data/models/phone-bench/models.json`, because the embedding resource is
a local SQLite vector database and not a GGUF generation model.

Rebuild both from the cleaned curated English JSONL with:

```powershell
cd C:\Work\caatuu\tools\caatuu-cz-ml
npm run cleanup:curriculum
npm run validate:curriculum:clean
npm run build:vector-db
```

The same command also ingests the manually curated miscellaneous and macaw
action image keymaps when they exist, stages the ignored post-install semantic
runtime, and refreshes:

```text
tools/caatuu-cz-ml/data/curriculum/core-v0.2/validation/vector-quality.json
tools/caatuu-cz-ml/data/curriculum/core-v0.2/reports/vector-quality.md
```

It also updates the embedding entries in:

```text
apps/caatuu-czech/static/setup-assets.json
```

That path is served by the existing Caatuu runtime under:

```text
/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite
```

The same database can be:

- built or inspected by local maintenance tooling with `rusqlite`
- opened by the browser with `sql.js`
- opened by the shared browser/Android WebView runtime with sql.js

The sql.js and Transformers.js browser bundles are vendored under
`apps/caatuu-czech/static/vendor/` and are part of the static app shell. The
generated ONNX/config/WASM runtime belongs under the active model's
`data/embeddings/.../runtime/` directory and remains ignored by Git. Track the
curated SQLite DB and manifest, but deliver those heavy runtime files through
the setup manifest.

The Rust server should only expose this file as a static asset through the
existing `/cz/...` static app path. Vector search and cleanup workflows belong
in the browser/WebView or local maintenance scripts so the Czech app keeps its
offline-first behavior after setup completes.

Android does not bundle the generated SQLite DB or semantic runtime in the APK.
The native bridge downloads and verifies them into app-private storage and
serves them back to the WebView asset path. The WebView then performs the same
MiniLM embedding and sql.js search as the browser PWA. Native `vector_search`
must reject a mismatched query embedder rather than silently use local hashing.

## Boundaries

Do not put semantic vector DB generation in the small runtime container. Build
MiniLM/ONNX refreshes from `caatuu-dev`; app runtime code consumes the generated
SQLite file and post-install runtime artifacts.

Do not wire this into the Chinese app. The current scope is `apps/caatuu-czech`
only.

Do not bundle heavy embedding or vector artifacts into the Android APK unless
there is a specific product reason. Android should download verified artifacts
into app-private storage after install, matching the GGUF model strategy.
