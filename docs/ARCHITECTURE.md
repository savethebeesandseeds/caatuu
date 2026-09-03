# Caatuu architecture

Caatuu is a workspace of deliberately separated platform components. The
learner-facing browser product is one application published through GitHub
Pages; the Rust server provides the same route surface only for local
development. Android, reporting, ML, animation, and archived code retain
distinct ownership boundaries.

## System map

```text
Browser or installed Android app
               |
               v
   caatuu.waajacu.com at Cloudflare
               |
               +-- ordinary site and APK paths ------> GitHub Pages
               +-- four large setup paths -> Worker -> pinned GitHub Release
               +-- two report paths --------> Worker -> EU D1
               +-- data-free health --------> Worker

Local only
   caatuu (caatuu-runtime)  loopback browser/APK/API testing on port 8765
   caatuu-dev               builds, tests, ML, Android, and release tooling
```

The deprecated Chinese trainer remains under `archive/caatuu-chinese` as
repository history only. The runtime does not mount it; `/zh-hans/*` redirects
to the canonical `/zh/*` course and deprecated trainer routes fail closed.

The local browser/server container does not contain the training stack. Model
training, export, Android builds, image work, and animation tooling use the
shared `caatuu-dev` environment plus narrowly bounded Compose profiles so daily
runtime startup remains small and reproducible. Public hosting has no
long-running workstation container or Cloudflare Tunnel.

## Application ownership

### `apps/launcher`

Owns the root launcher, language catalog, shared visual assets, and branded 404
surface. It does not own language-specific learning logic.

### `apps/languages`

Owns the authoritative course catalog and one manifest-backed directory per
target language. Each course owns its target realizations, language adapter,
linguistic features, enabled games, platform enablement, capabilities, and narrow package asset
catalog. Czech is the active reference course; Mandarin is a fresh development
course at `/zh/`. The repository-only Chinese archive is not a course source.
The exact shared-versus-language boundary is defined in
[the language application contract](LANGUAGE_APP_CONTRACT.md).

### `apps/language-runtime`

Owns the one canonical browser product document, bootstrap, shell, game
registry, and browser-safe mechanics shared by courses: the language adapter
ABI, English-concept/target-realization join, deterministic fallback, and
English MiniLM ranking boundary. The public ABI uses
`/language-runtime/`; course code does not import another course's URLs.
Language-specific text, pronunciation, segmentation, and accepted answers stay
inside the target pack and never enter the English embedding payload.

### `apps/android`

Packages a manifest-selected course for Android and supplies native
capabilities such as offline llama.cpp inference, model lifecycle management,
vector database installation, and application updates. Czech remains the
enabled default; disabled courses cannot be packaged. BuildConfig and asset
selection are derived from the same course manifest and capability flags used
by the browser/server contracts. The native bridge is an adapter; it must not
silently fork browser behavior or expose a capability the selected course does
not declare.

### `apps/games`

Owns language-independent authored games, the game catalog, and per-game build
and delivery manifests. Generated exports live under `artifacts/games`.
Standalone previews are feature-gated and do not become browser-app or Android
payloads merely because the server can expose them. Embedded games require a
separate reviewed host contract and platform decision. The detailed boundaries
are recorded in
[`docs/decisions/0001-game-source-delivery-and-language-ownership.md`](decisions/0001-game-source-delivery-and-language-ownership.md)
and
[`docs/decisions/0002-standalone-caatuu-game-and-app-release-boundary.md`](decisions/0002-standalone-caatuu-game-and-app-release-boundary.md).

### `apps/server`

Owns the local HTTP routing, manifest-driven language mounts, narrowly exposed
shared language runtime, static surface assembly, operational configuration,
and fail-closed boundaries for deprecated routes. It is not a public origin.
Top-level legacy Chinese API and WebSocket paths are retired. `/zh-hans` and
`/zh-hans/**` redirect only to the canonical `/zh/` course; archived sources
are never mounted.

### `apps/reporting-worker`

Owns the only public dynamic boundary: two consent-gated, write-only reporting
routes, one data-free health route, and four exact resumable-download proxies.
Reports go to D1 with no public read API. Live requests for the four large setup
files come from fixed assets in the pinned GitHub Release; the Pages
preservation bundle also validates copies of those bytes. The Worker validates
their lengths and range responses and does not buffer or store them. Every
other public path bypasses the Worker and goes to GitHub Pages.

### `apps/animated-fabric`

Is a Linux-first desktop application and Python library for layered 2D
animation. It retains its own specification, tests, and Python dependency
boundary while using the shared `caatuu-dev` environment and root Compose
project. Caatuu may consume deliberate exports; it does not import the Python
package at runtime.

## Supporting areas

- `tools/` contains maintained build and generation workflows. Generated
  workspaces, caches, models, and local research inputs remain ignored.
- `archive/` preserves inactive implementations and experiments. Archived code
  is not a source of default routes, assets, or configuration.
- `artifacts/` contains local build outputs and research workspaces and is never
  source-controlled.
- `secrets/` contains local tokens or keys and is never source-controlled.

## Operational boundaries

The root Compose project contains the normal server plus opt-in services behind
profiles. Files under `compose/` are narrow overrides for exceptional modes.

| File | Responsibility |
| --- | --- |
| `compose.yaml` | Local runtime plus opt-in `tools`, `dev`, and specialist profiles; no public tunnel |
| `compose/dev-gpu.yaml` | Adds GPU access to the same `caatuu-dev` service and project |
| `compose/dev-gui.yaml` | Adds native-X11 forwarding to the same `caatuu-dev` service and project |
| `compose/phone-debug.yaml` | Explicit trusted-LAN exposure for phone debugging |

Profiles keep build and ML services out of normal startup. Explicit overrides
prevent a normal local startup from exposing a LAN-facing debug server. The
repository-only Chinese archive has no runtime override.

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
