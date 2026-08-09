# Czech runtime data

This directory separates authored learning content from runtime infrastructure.

- `games/<game-id>/` contains reviewed data owned by a specific game.
- `language/` contains reviewed Czech content shared by the language app.
- `dictionaries/` contains the full downloadable dictionary catalog, patches,
  attribution, and versioned database metadata.
- `embeddings/` contains semantic-search catalogs and generated vector assets.
- `models/` contains local-model runtime catalogs and generated model assets.

Do not add game datasets at the root. A new game should receive its own stable
directory under `games/`.
