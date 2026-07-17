# Caatuu full dictionaries

The curated learner dictionary remains at `../dictionary.json`. It is the
ordered Core dictionary and must not be overwritten or reordered by a full
dictionary build.

The full Czech-to-English dictionary is generated from the English
Wiktionary Czech extract published by Kaikki. Build it inside the existing
`caatuu-dev` container:

```bash
cd /workspace/tools/czech-ml
npm run build:full-dictionary
```

The command pins provenance in `catalog.json` and the versioned `manifest.json`,
then writes a generated SQLite database. The SQLite file and downloaded source
JSONL are intentionally ignored by Git. The generated pack supports dictionary
and learning-game features throughout Caatuu and is not a model-training input.

The dictionary developer tool remains available at:

```text
/cz/index.html?advanced=cz-dictionary#dictionary
```

The browser runtime queries the local Rust SQLite endpoint. Android keeps the
same database outside the APK. Initial setup downloads and verifies it into
app-private storage; lookups then run locally through Android SQLite and work
offline.

See `ATTRIBUTION.md` for licensing and modifications.
