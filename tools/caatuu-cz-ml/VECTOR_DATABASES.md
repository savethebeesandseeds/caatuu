# Caatuu CZ Vector Databases

This is the local-first vector database plan for the Czech app only.

## Goal

Use one SQLite schema across:

- server/container runtime
- browser PWA
- Android app

The repo should keep the curated curriculum data useful to other people. The
current SQLite vector index is tracked alongside the JSONL corpus. The Android
APK should still stay light: it downloads the SQLite DB after install instead
of bundling it. Heavier future artifacts such as ONNX weights, tensor blobs, and
GGUF files should stay outside Git unless we explicitly decide otherwise.

## Canonical Schema

The source of truth is:

```text
tools/caatuu-cz-ml/vector-schema.sql
```

The current generated embedding model is:

```text
caatuu-local-hash-v0.1
```

Current fixed assumptions:

- model id: `caatuu-local-hash-v0.1`
- dimensions: `384`
- max tokens: `512`
- pooling: `signed_hashing`
- vectors: normalized `float32le`
- vector input: English sentence text only (`english_text`)
- manifest/schema rule: `embedding_text_field = english_text` and
  `embedding_input_policy = english_text_only`
- distance: cosine similarity
- license: MIT

Curriculum metadata such as topic, target words, grammar tags, difficulty, and
age band is stored in SQLite JSON fields for filtering and review. It is not
embedded into the vector.

Manual image asset descriptions use the same local hash model. Those rows are
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

`BAAI/bge-small-en-v1.5` remains the planned semantic embedding replacement.
Do not label locally hashed vectors as BGE vectors.

## Runtime Shape

The generated database should be published under:

```text
apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

This current SQLite database is a tracked curated-data artifact.

The matching tracked manifest should be updated at:

```text
apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/manifest.json
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
action image keymaps when they exist and refreshes:

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
/cz/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

The same database can be:

- built or inspected by local maintenance tooling with `rusqlite`
- opened by the browser with `sql.js`
- downloaded and opened by Android with the platform SQLite API

The browser runtime files are vendored under
`apps/caatuu-czech/static/vendor/sql.js/` and are part of the static app shell.
Do not move them under `data/embeddings/`; that directory is for generated
embedding artifacts. Track the current curated SQLite DB and manifest there, but
keep heavier future runtime/output files ignored unless they become deliberate
corpus artifacts.

The Rust server should only expose this file as a static asset through the
existing `/cz/...` static app path. Vector search and cleanup workflows belong
in the browser, Android app, or local maintenance scripts so the Czech app keeps
its offline-first behavior after the database is downloaded.

Android does not bundle the generated SQLite DB in the APK. The native bridge
downloads and verifies it into app-private storage, exposes `vector_status`,
`vector_download`, and `vector_search`, and can serve the downloaded DB back to
the WebView asset path for browser-side sql.js usage.

## Boundaries

Do not put heavy semantic vector DB generation in the small runtime container.
The current local hash index is light enough to rebuild locally from the curated
corpus, but app runtime code should consume the generated static SQLite file.
Future BGE/ONNX refreshes should be built from `caatuu-dev`, then published into
the static app folder.

Do not wire this into the Chinese app. The current scope is `apps/caatuu-czech`
only.

Do not bundle heavy embedding or vector artifacts into the Android APK unless
there is a specific product reason. Android should download verified artifacts
into app-private storage after install, matching the GGUF model strategy.
