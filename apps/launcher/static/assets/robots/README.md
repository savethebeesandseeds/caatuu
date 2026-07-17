# Robot assets

This folder contains the standalone robot visual assets used by Caatuu.

- `robot (1).png` through `robot (33).png` are sequentially indexed game sprites.
- `word-world-waiting.svg` is the Word World loading illustration.
- `keymap.json` is the authoritative retrieval catalog for every robot asset in this folder.
- Every keymap entry points to `robot_embedding_refs` in `/data/vector/caatuu-cz-curriculum.sqlite`.

When assets or descriptions change, rebuild the vector database with
`tools/czech-ml/scripts/build-curriculum-vector-db.mjs` so the embeddings,
manifest, and setup asset catalog remain synchronized.
