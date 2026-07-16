# Caatuu

Caatuu is a local-first language-learning platform built around playful,
interactive worlds. The current product focuses on Czech and combines a browser
experience, a native Android shell, offline language models, dictionaries, and
retrieval tools in one workspace.

[![Repository checks](https://github.com/savethebeesandseeds/caatuu/actions/workflows/repository-ci.yml/badge.svg)](https://github.com/savethebeesandseeds/caatuu/actions/workflows/repository-ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

> Caatuu is a development preview. It is not yet a supported public beta or a
> stable release. See the [product-readiness baseline](docs/PRODUCT_READINESS.md)
> before distributing builds.

## What is here

| Surface | Purpose |
| --- | --- |
| [`apps/caatuu-czech`](apps/caatuu-czech/) | Czech browser app, learning activities, local model setup, dictionaries, and vector retrieval |
| [`apps/caatuu-android`](apps/caatuu-android/) | Native Android shell with offline GGUF inference and app-update support |
| [`apps/caatuu-runtime`](apps/caatuu-runtime/) | Rust/Axum server for the launcher, app routes, downloads, and optional archived APIs |
| [`apps/caatuu-unified`](apps/caatuu-unified/) | Shared landing page, language launcher, and production asset catalog |
| [`apps/animated-fabric`](apps/animated-fabric/) | Isolated Linux-first toolkit for layered 2D character animation |
| [`demos`](demos/) | Browser experiments that are deliberately separated from production apps |

The active Czech experience is available as a browser app and through the
Android shell. Archived Chinese experiments remain available for historical
reference but are not part of the active product path.

## Quick start

The repository uses Docker as its authoritative development environment. From
PowerShell:

```powershell
cd C:\Work\caatuu
docker compose up -d --build caatuu
```

Open:

- `http://127.0.0.1:8765/` — launcher
- `http://127.0.0.1:8765/cz/` — Czech app
- `http://127.0.0.1:8765/demos/` — isolated demos

After the first build, normal daily startup is:

```powershell
docker compose up -d caatuu
```

See [development and operations](docs/DEVELOPMENT.md) for logs, the public
tunnel, Android builds, ML tooling, archived APIs, and validation commands.

## Repository map

```text
caatuu/
├── apps/       active applications with independent runtime boundaries
├── archive/    preserved, non-active product experiments
├── demos/      isolated browser and animation experiments
├── docs/       architecture, development, release, and governance records
├── tools/      Android, ML, runtime, image, and repository tooling
├── .github/    CI and GitHub community files
└── compose*.yaml
```

Root-level Compose files are intentional entrypoints. Runtime, tools, archived
API, and phone-debug configuration stay separate so high-risk or heavyweight
features are never enabled by normal startup.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Language application contract](docs/LANGUAGE_APP_CONTRACT.md)
- [Development and operations](docs/DEVELOPMENT.md)
- [Release policy](docs/RELEASING.md)
- [Licensing scope](docs/LICENSING.md)
- [Legal and provenance inventory](docs/LEGAL_INVENTORY.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security](.github/SECURITY.md)
- [Support](.github/SUPPORT.md)

Each substantial app and tool owns a local README with commands and boundaries
specific to that component. Start at the root, then follow the README nearest
to the code you are changing.

## License and release status

First-party software and developer documentation are licensed
[`AGPL-3.0-only`](LICENSE). Models, datasets, dictionaries, artwork, branding,
and third-party components retain separate terms; consult
[the licensing guide](docs/LICENSING.md) and
[the provenance inventory](docs/LEGAL_INVENTORY.md).

Public debug APKs are development artifacts, not normal downloads. A release
must pass the gates in [the release policy](docs/RELEASING.md).
