# Macaw Action Assets

This folder contains manually reviewed macaw action sprites served by the
runtime under:

```text
/assets/macaw/actions/
```

The curated action keymap is:

```text
keymaps.json
```

Each top-level key is the browser-facing asset path. Each value keeps:

- `description`: a short English description written after visually inspecting the image.
- `category`: `macaw_action`.
- `action`: a stable action slug for filtering.
- `embedding`: a reference to the SQLite vector database row for that description.

Do not put full embedding vectors in `keymaps.json`. The vectors belong in the
Czech vector SQLite file under:

```text
apps/caatuu-czech/static/data/embeddings/caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite
```

## Manual Update Workflow

1. Add or replace image files in this folder.
2. Open every changed image and write or update its English `description`.
3. Assign the `macaw_action` category and a stable `action` slug.
4. Add or update the `embedding` DB reference in `keymaps.json`.
5. Rebuild the vector database from the manually curated keymap:

```powershell
cd C:\Work\caatuu\tools\caatuu-cz-ml
npm run build:vector-db
```

The rebuild command embeds the manual descriptions already present in the
keymaps and refreshes the SQLite database, embedding manifest, embedding
catalog, and setup manifest hashes.
