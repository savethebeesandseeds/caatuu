# Mandarin course content

This directory contains fresh Mandarin realizations authored in the `zh-Hans`
script and locale. It does not reuse
the retired Chinese trainer or its corpus.

English concept records live under
`apps/languages/shared/english-concepts/`. Only their authored English
`embeddingText` fields may enter the English MiniLM embedder. Files here map
those stable concept IDs to Simplified Chinese learner text, authored word
boundaries, and generic authored pronunciation objects. This pack explicitly
selects `mandarin-simplified-v1`; that named policy—not the shared schema—owns
the Hans, pinyin, and contextual polyphone checks.

The starter realization pack is a machine-assisted draft. Its release gate is
intentionally `native-review-required`; it must not make the course active or
authorize release pronunciation guidance until a qualified Mandarin reviewer
records approval and the project records final content licensing. The
development course may expose a separate catalog explicitly marked
`machine-assisted-preview` for browser and preview-APK evaluation. That catalog
does not alter the approved learner projection or satisfy the release gate.

The pack declares `authored-word-tokens` with contextual token pronunciation.
Consumers must preserve those boundaries; deriving pronunciation from one Han
character at a time is not a supported fallback because polyphonic characters
depend on their word and sentence context. While the catalog remains
`native-review-required`, every authored pronunciation object is marked
`reviewed: false` and the learner runtime projection omits pronunciation
entirely. Native approval must update the catalog gate and all pronunciation
objects consistently before learner-facing adapters may consume them.
