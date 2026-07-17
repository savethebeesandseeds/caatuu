# Caatuu Czech Embeddings

This folder is for local vector database artifacts used by the Czech app.

Tracked files here should stay small: manifests, checksums, and documentation.
The current curated curriculum SQLite database is tracked because it is part of
the reusable corpus. ONNX weights, WASM runtimes, and other heavy future
artifacts are ignored by Git and should be rebuilt or downloaded as needed.

The active local semantic model is:

```text
all-minilm-l6-v2-qint8-v0.1
```

It is the Apache-2.0 licensed `sentence-transformers/all-MiniLM-L6-v2`, pinned
at revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` and served through a
qint8 ARM64 ONNX model. The heavy ONNX and ONNX Runtime WASM files are generated
under the model's `runtime/` directory, ignored by Git, and downloaded by the
app's setup flow.

That generated runtime also contains `THIRD_PARTY_NOTICES.json` and the Apache
2.0 license text. The notice pins the model, Transformers.js, and ONNX Runtime
Web source revisions and records their Apache-2.0/MIT terms.

The vector input is the English sentence text only. Curriculum metadata is kept
inside SQLite for filters and debugging, but it is not embedded into the vector.

The database can also include manually described image assets. Those rows are
stored as `source_kind = image_asset` or `source_kind = macaw_action_asset`,
with lookup references in `asset_embedding_refs` and
`macaw_action_embedding_refs`. The current human-curated miscellaneous image
keymap lives at:

```text
apps/launcher/static/assets/visual-vocabulary/keymap.json
```

The current human-curated macaw action keymap lives at:

```text
apps/launcher/static/assets/macaw/actions/keymaps.json
```

Those asset vectors are computed from the manual English descriptions in those
JSON files, not from the image pixels.

The current generated database path is:

```text
data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite
```

It is generated from:

```text
tools/czech-ml/data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl
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

`caatuu-local-hash-v0.1` remains available only for rollback and diagnostics.
Do not compare its vectors with the active MiniLM vectors.
