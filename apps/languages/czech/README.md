# Caatuu Czech

This pack is the English-to-Czech course. The shared product document serves
it at `/cz/`. This directory owns the Czech manifest, adapter, dictionaries,
game catalogs, and optional local model assets. It does not own a separate
application shell.

`course.json` is the identity and capability authority. Chat, the full
dictionary, and the Czech model files under `static/data/models/` are
capabilities declared by this manifest. Other courses declare their own.

Use the workspace README for the local container:

```text
../../../README.md
```

The heavier ML workspace remains separate:

```text
C:\Work\caatuu\tools\czech-ml
```

That workspace is only needed for future dataset rebuilds, training, and model
exports. The current demo model is already exported into `static/data/models/`.

## Vector Database Infrastructure

The Czech app has a standalone browser-side vector database manager at:

```text
static/vector-db.js
```

It expects the shared SQLite schema from:

```text
C:\Work\caatuu\tools\czech-ml\vector-schema.sql
```

Generated embedding databases should be published under
`static/data/embeddings/`. Heavy future artifacts such as `.onnx`, `.wasm`,
`.bin`, and `.safetensors` are intentionally ignored by Git.

The current lightweight generated database uses model id
`caatuu-local-hash-v0.1` and is generated at:

```text
static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

The current curated curriculum SQLite database is tracked in Git because it is a
useful data artifact. Its tracked manifest lives at:

```text
static/data/embeddings/caatuu-local-hash-v0.1/manifest.json
```

The embedding resource catalog lives at:

```text
static/data/embeddings/models.json
```

That catalog is separate from the GGUF generation catalog under
`static/data/models/phone-bench/`.

It is rebuilt from the cleaned English curriculum corpus with:

```powershell
cd C:\Work\caatuu\tools\czech-ml
npm run cleanup:curriculum
npm run validate:curriculum:clean
npm run build:vector-db
```

The browser manager uses the vendored sql.js runtime under
`static/vendor/sql.js/` so local/offline browser use does not depend on a CDN.

The runtime serves that file as a static asset under `/cz/data/embeddings/...`.
The browser and Android app should download/open the SQLite file locally and run
vector queries offline; there is intentionally no vector search API on the
server.
