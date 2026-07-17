# Caatuu architecture

Caatuu is a workspace of deliberately separated applications rather than one
large application. The Rust runtime assembles the public routes, while browser,
Android, ML, animation, and archived code retain distinct ownership boundaries.

## System map

```text
Browser                         Android app
   |                                |
   | HTTP                           | packaged web assets + native bridge
   v                                v
caatuu-runtime                 offline GGUF inference
   |
   +-- /                  unified launcher
   +-- /cz/               Czech browser app
   +-- /demos/            isolated experiments
   +-- /archive/chinese/  preserved Chinese app
   +-- /android/          governed build artifacts and manifests
```

The normal browser/runtime container does not contain the training stack. Model
training, export, Android builds, image work, and animation tooling use separate
containers so daily startup remains small and reproducible.

## Application ownership

### `apps/launcher`

Owns the root launcher, language catalog, shared visual assets, and branded 404
surface. It does not own language-specific learning logic.

### `apps/languages/czech`

Owns Czech learning screens, browser-side model setup, local dictionaries,
embeddings, service-worker behavior, and language-specific interaction logic.
The exact shared-versus-language boundary is defined in
[the language application contract](LANGUAGE_APP_CONTRACT.md).

### `apps/android`

Packages the Czech experience for Android and supplies native capabilities such
as offline llama.cpp inference, model lifecycle management, vector database
installation, and application updates. The native bridge is an adapter; it must
not silently fork browser behavior.

### `apps/runtime`

Owns HTTP routing, static surface assembly, operational configuration, and the
explicit opt-in boundary for archived backend routes. Top-level legacy Chinese
API and WebSocket paths are retired.

### `apps/animated-fabric`

Is an independent Linux-first desktop application and Python library for
layered 2D animation. It has its own Compose project, specification, tests, and
dependency boundary. Caatuu may consume deliberate exports; it does not import
the Python package at runtime.

## Supporting areas

- `demos/` contains browser experiments. A demo is not a production asset
  catalog and must not be mounted at an active app route by accident.
- `tools/` contains maintained build and generation workflows. Generated
  workspaces, caches, models, and local research inputs remain ignored.
- `archive/` preserves inactive implementations. Archived code is not a source
  of default routes or configuration.
- `artifacts/` contains local build outputs and is never source-controlled.
- `secrets/` contains local tokens or keys and is never source-controlled.

## Operational boundaries

The root Compose project contains the normal runtime plus opt-in services behind
profiles. Files under `compose/` are narrow overrides for exceptional modes.

| File | Responsibility |
| --- | --- |
| `compose.yaml` | Runtime plus opt-in `tunnel`, `tools`, and `dev` profiles |
| `compose/archived-chinese.yaml` | Explicitly enables the archived Chinese backend |
| `compose/archived-chinese-openai.yaml` | Separately mounts the optional OpenAI secret |
| `compose/phone-debug.yaml` | Explicit trusted-LAN exposure for phone debugging |

Profiles keep build and ML services out of normal startup. Explicit overrides
prevent a normal local startup from enabling billable archived APIs or a
LAN-facing debug server.

## Change rules

1. Read the nearest README and repository instructions before changing a
   component.
2. Preserve app and container boundaries; shared code must have a real shared
   contract, not merely a convenient import path.
3. Keep generated artifacts out of Git unless they are intentional,
   reproducible runtime payloads with documented provenance.
4. Run the runtime boundary audit after route, browser shell, packaged asset,
   or Android changes.
5. Treat release status, licensing, privacy, and security documents as product
   contracts rather than presentation copy.
