# Miscellaneous Character Assets

This folder contains manually reviewed visual assets served by the runtime under:

```text
/assets/miscellaneous/
```

The original object, city, and scenery sheets are preserved under
`originals/`. Keep them as archival source art even when processed vocabulary
images already exist at the top level.

The curated image keymap is:

```text
keymap.json
```

Each top-level key is the browser-facing asset path. Each value keeps:

- `description`: a visually accurate English description followed by common
  retrieval vocabulary for the object's function, setting, and related everyday
  concepts. Use concrete ordinary words that accurately describe the image.
- `category`: a short category label for filtering.
- `embedding`: a reference to the shared artwork index, using model ID,
  `source_kind: "image_asset"`, and the public `asset_path`.

Do not put full embedding vectors in `keymap.json`. The vectors belong in the
language-neutral index served at:

```text
/language-runtime/static/data/image-embeddings/minilm-v1.json
```

## Manual Update Workflow

1. Add or replace image files in this folder.
2. Open every changed image and write or update its English `description`.
   Identify the visible subject first, then include accurate common terms for
   what it does, where it belongs, and which everyday ideas it can represent.
3. Assign exactly one short `category` label.
4. Keep the `embedding` reference's `index`, `model_id`, `source_kind`, and
   `asset_path` synchronized with the entry.
5. Rebuild the shared index and refresh offline delivery in the existing
   container from the canonical checkout:

```powershell
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --register-shared-runtime
```

The rebuild command does not describe images automatically. It only embeds the
manual English descriptions already present in the artwork catalogs. It stores
vectors and source checksums in the shared index; the delivery refresh updates
setup manifest hashes.
