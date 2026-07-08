# Caatuu Czech Embeddings

This folder is for local vector database artifacts used by the Czech app.

Tracked files here should stay small: manifests, checksums, and documentation.
The current curated curriculum SQLite database is tracked because it is part of
the reusable corpus. ONNX weights, WASM runtimes, and other heavy future
artifacts are ignored by Git and should be rebuilt or downloaded as needed.

The current lightweight local model is:

```text
caatuu-local-hash-v0.1
```

The vector input is the English sentence text only. Curriculum metadata is kept
inside SQLite for filters and debugging, but it is not embedded into the vector.

The database can also include manually described image assets. Those rows are
stored as `source_kind = image_asset`, with lookup references in
`asset_embedding_refs`. The current human-curated image keymap lives at:

```text
apps/caatuu-unified/static/assets/characters/miscellaneous/keymap.json
```

Those asset vectors are computed from the manual English descriptions in that
JSON file, not from the image pixels.

The current generated database path is:

```text
data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

It is generated from:

```text
tools/caatuu-cz-ml/data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
```

Keep the small `manifest.json` next to the SQLite file updated with bytes,
SHA-256, and row counts so the browser and Android app can verify downloaded
copies.

The public embedding catalog is:

```text
data/embeddings/models.json
```

Keep it separate from the GGUF generation model catalog. This artifact is a
local SQLite vector database, not a chat model.

`BAAI/bge-small-en-v1.5` remains a planned semantic embedding replacement. Do
not label local hash vectors as BGE vectors.
