# Miscellaneous Character Assets

This folder contains manually reviewed visual assets served by the runtime under:

```text
/assets/miscellaneous/
```

The curated image keymap is:

```text
keymap.json
```

Each top-level key is the browser-facing asset path. Each value keeps:

- `description`: a short English description written after visually inspecting the image.
- `category`: a short category label for filtering.
- `embedding`: a reference to the SQLite vector database row for that description.

Do not put full embedding vectors in `keymap.json`. The vectors belong in the
Czech vector SQLite file under:

```text
apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

## Manual Update Workflow

1. Add or replace image files in this folder.
2. Open every changed image and write or update its English `description`.
3. Assign exactly one short `category` label.
4. Add or update the `embedding` DB reference in `keymap.json`.
5. Rebuild the vector database from the manually curated keymap:

```powershell
cd C:\Work\caatuu\tools\caatuu-cz-ml
npm run build:vector-db
```

The rebuild command does not describe images automatically. It only embeds the
manual descriptions already present in `keymap.json` and refreshes the SQLite
database, embedding manifest, embedding catalog, and setup manifest hashes.
