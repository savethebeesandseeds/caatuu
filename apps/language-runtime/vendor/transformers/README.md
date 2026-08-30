# Transformers.js browser runtime

Vendored from `@huggingface/transformers@4.2.0` (Apache-2.0).

This shared copy is the canonical browser dependency for every language course
that selects the English MiniLM runtime. Its exact bytes and license are pinned
in `../../embedding-runtimes.json`; the server exposes only the reviewed bundle
and license, not this repository note.

Large ONNX and WASM files live under `../../models/`, remain ignored by Git, and
must pass the shared size and SHA-256 readiness check before the server starts.
