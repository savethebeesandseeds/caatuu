# Macaw Action Assets

This folder contains manually reviewed macaw action sprites served by the
runtime under:

```text
/assets/macaw/actions/
```

The source sheets used to create these processed sprites are preserved under
`originals/`. Keep them as archival source art even when every visible frame
has already been extracted.

The curated action keymap is:

```text
keymaps.json
```

Each top-level key is the browser-facing asset path. Each value keeps:

- `description`: a short English description written after visually inspecting the image.
- `category`: `macaw_action`.
- `action`: a stable action slug for filtering.
- `embedding`: a reference to the shared artwork index, using model ID,
  `source_kind: "macaw_action_asset"`, and the public `asset_path`.

Do not put full embedding vectors in `keymaps.json`. The vectors belong in the
language-neutral index served at:

```text
/language-runtime/static/data/image-embeddings/minilm-v1.json
```

## Manual Update Workflow

1. Add or replace image files in this folder.
2. Open every changed image and write or update its English `description`.
3. Assign the `macaw_action` category and a stable `action` slug.
4. Keep the `embedding` reference's `index`, `model_id`, `source_kind`, and
   `asset_path` synchronized with the entry.
5. Rebuild the shared index and refresh offline delivery in the existing
   container from the canonical checkout:

```powershell
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --register-shared-runtime
```

The rebuild command embeds only the manual English descriptions already
present in the artwork catalogs. It stores vectors and source checksums in the
shared index; the delivery refresh updates setup manifest hashes.
