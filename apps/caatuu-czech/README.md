# Caatuu Czech

Caatuu Czech is a static browser app for Czech study and on-device WebLLM
testing.

The runtime app is Python-free. It serves files from `static/` and loads the
current browser-ready Czech model export from `static/data/models/`.

In the unified Caatuu container it is served at:

```text
/cz/
/cz/home.html
/cz/chat.html
```

Use the workspace README for container and Cloudflare commands:

```text
C:\Work\caatuu\README.md
```

The heavier ML workspace remains separate:

```text
C:\Work\caatuu\tools\caatuu-cz-ml
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
C:\Work\caatuu\tools\caatuu-cz-ml\vector-schema.sql
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
cd C:\Work\caatuu\tools\caatuu-cz-ml
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
