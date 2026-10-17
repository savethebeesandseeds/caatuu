# Robot assets

This folder contains the standalone robot visual assets used by Caatuu.

- `robot (1).png` through `robot (33).png` are sequentially indexed game sprites.
- `keymap.json` is the authoritative retrieval catalog for every robot asset in this folder.
- Every keymap entry contains a manually reviewed English description and an
  `embedding` reference to
  `/language-runtime/static/data/image-embeddings/minilm-v1.json`.

References contain `index`, `model_id`, `source_kind: "robot_asset"`, and the
encoded public `asset_path`. Full vectors live only in the shared artwork
index. They are computed from the English description, independently of the
Czech curriculum database.

When assets or descriptions change, inspect the images, update the catalog, and
run from the canonical checkout:

```powershell
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --register-shared-runtime
```
