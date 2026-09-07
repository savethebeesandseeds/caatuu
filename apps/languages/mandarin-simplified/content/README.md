# Mandarin course content

This directory contains fresh Mandarin realizations authored in the `zh-Hans`
script and locale. It does not reuse
the retired Chinese trainer or its corpus.

Edit [word-world/content.json](word-world/content.json), the complete Mandarin
Word World source. English concepts and target realizations are generated
compatibility views of it. Only its authored English `embeddingText` fields may
enter the English MiniLM embedder. The unified records connect stable concept
IDs to Simplified Chinese learner text, authored word
boundaries, and generic authored pronunciation objects. This pack explicitly
selects `mandarin-simplified-v1`; that named policy—not the shared schema—owns
the Hans, pinyin, and contextual polyphone checks.

The starter realization pack is a machine-assisted draft. Its language review
gate is intentionally `native-review-required`; it must not make the course
active or authorize approved authored pronunciation guidance until a qualified
Mandarin reviewer records approval. The first-party English concepts and Mandarin
realizations are release-cleared under `AGPL-3.0-only`. The disclosed
development course may be packaged and published in browser and APK builds;
pending native review is advisory for that distribution, not a publication
block. It may expose a separate catalog explicitly marked
`machine-assisted-preview`. That catalog does not alter the learner projection
or satisfy the activation and approved-pronunciation gate.

The pack declares `authored-word-tokens` with contextual token pronunciation.
Consumers must preserve those boundaries; deriving pronunciation from one Han
character at a time is not a supported fallback because polyphonic characters
depend on their word and sentence context. While the catalog remains
`native-review-required`, every authored pronunciation object is marked
`reviewed: false` and the learner runtime projection omits pronunciation
entirely. Native approval must update the catalog gate and all pronunciation
objects consistently before learner-facing adapters may consume them.
