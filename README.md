# Caatuu

> A local-first, open-source platform for learning any language through playful
> interactive worlds, offline AI, dictionaries, and intelligent retrieval.

[![Repository checks](https://github.com/savethebeesandseeds/caatuu/actions/workflows/repository-ci.yml/badge.svg)](https://github.com/savethebeesandseeds/caatuu/actions/workflows/repository-ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Caatuu turns language learning into an explorable experience. Instead of
building a separate product for every language, it provides one adaptable
platform where each course can bring its own writing system, vocabulary,
grammar, dictionaries, models, prompts, and learning activities.

The same product shell can support many languages without pretending that all
languages work alike. Shared concerns such as navigation, accessibility,
setup, updates, feedback, and storage stay consistent, while real linguistic
differences remain inside language-owned adapters.

> **Development status:** Caatuu is an active development preview, not yet a
> supported public beta or stable release. Czech is the current reference
> implementation. The platform architecture is designed for any language, but
> additional courses become active only after they reach the same product and
> runtime standards. See the
> [product-readiness baseline](docs/PRODUCT_READINESS.md).

## What Caatuu is building

- **Playful learning worlds:** Games and interactive spaces make vocabulary,
  meaning, memory, and grammar part of exploration rather than a list of
  disconnected exercises.
- **A platform for any language:** Course profiles and language adapters keep
  language-specific rules out of the shared product shell.
- **Local-first intelligence:** Offline models, dictionaries, embeddings, and
  retrieval tools can support learning without requiring every interaction to
  leave the device.
- **Web and Android experiences:** The browser app and native Android shell
  share the same course while Android adds device capabilities such as local
  model management and inference.
- **Open, inspectable building blocks:** Runtime, language apps, animation,
  model tooling, and experiments have explicit boundaries and reproducible
  development workflows.

## One product, many language courses

```text
Shared product shell
  navigation, themes, setup, updates, feedback, accessibility
          |
          v
Course profile
  language identity, route, locale, capabilities, storage namespace
          |
          v
Language adapter
  writing system, tokenization, morphology, dictionaries, prompts, games
          |
          v
Platform adapter
  browser or Android capabilities, offline models, native integration
```

A new language should not require a fork of the entire application. It should
provide a course profile, its genuine linguistic behavior, and the resources
needed by its declared capabilities. Mechanics are shared only when their
contracts make sense without naming a particular language.

The full boundary is documented in the
[language application contract](docs/LANGUAGE_APP_CONTRACT.md).

## What works today

The active Czech course is the first reference path. It combines:

- browser-based learning activities and playful language games;
- a native Android shell;
- offline GGUF language-model inference;
- local dictionaries and vector databases;
- semantic retrieval and language-aware content; and
- shared setup, update, feedback, theme, and navigation systems.

Earlier Chinese work is retained under `archive/` for historical reference. It
is not presented as an active course until it meets the current shared language
contract. Future languages follow the same rule: a route or translated screen
alone is not enough; each course must provide real language behavior and pass
the platform checks.

## Workspace

| Surface | Purpose |
| --- | --- |
| [`apps/caatuu-unified`](apps/caatuu-unified/) | Shared launcher, language registry, product assets, and common entry experience |
| [`apps/caatuu-czech`](apps/caatuu-czech/) | Active Czech reference course, learning activities, dictionaries, models, and retrieval |
| [`apps/caatuu-android`](apps/caatuu-android/) | Native Android shell, offline inference, model lifecycle, and application updates |
| [`apps/caatuu-runtime`](apps/caatuu-runtime/) | Rust/Axum server for public routes, downloads, and explicit archived boundaries |
| [`apps/animated-fabric`](apps/animated-fabric/) | Independent toolkit for creating reusable layered 2D character animation |
| [`demos`](demos/) | Isolated browser, interaction, and animation experiments |
| [`tools`](tools/) | Maintained Android, ML, vector, runtime, image, and repository workflows |
| [`archive`](archive/) | Preserved implementations that are not part of the active product path |

## Quick start

Docker is the authoritative development environment. From PowerShell:

```powershell
cd C:\Work\caatuu
docker compose up -d --build caatuu
```

Open:

- `http://127.0.0.1:8765/` - language launcher
- `http://127.0.0.1:8765/cz/` - active Czech course
- `http://127.0.0.1:8765/demos/` - isolated experiments

After the first build, normal daily startup is:

```powershell
docker compose up -d caatuu
```

See [development and operations](docs/DEVELOPMENT.md) for logs, container
boundaries, Android builds, ML tooling, public-tunnel configuration, archived
APIs, and validation commands.

## Repository map

```text
caatuu/
|-- apps/       active applications with independent ownership boundaries
|-- archive/    preserved, non-active product implementations
|-- demos/      isolated browser and animation experiments
|-- docs/       architecture, development, release, and governance records
|-- tools/      Android, ML, runtime, image, and repository tooling
|-- .github/    CI workflows and community files
`-- compose*.yaml
```

Root-level Compose files are intentional entrypoints. The normal runtime,
heavy development tools, archived APIs, and phone-debug configuration remain
separate so ordinary startup does not silently enable GPU tooling, billable
services, or a LAN-facing debug server.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Language application contract](docs/LANGUAGE_APP_CONTRACT.md)
- [Development and operations](docs/DEVELOPMENT.md)
- [Product-readiness baseline](docs/PRODUCT_READINESS.md)
- [Release policy](docs/RELEASING.md)
- [Licensing scope](docs/LICENSING.md)
- [Legal and provenance inventory](docs/LEGAL_INVENTORY.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security](.github/SECURITY.md)
- [Support](.github/SUPPORT.md)

Each substantial application and tool owns a nearby README with its specific
commands and boundaries. Start here, then follow the documentation closest to
the component being changed.

## License and release status

First-party software and developer documentation are licensed
[`AGPL-3.0-only`](LICENSE). Models, datasets, dictionaries, artwork, branding,
and third-party components retain separate terms; consult the
[licensing guide](docs/LICENSING.md) and
[provenance inventory](docs/LEGAL_INVENTORY.md).

Public debug APKs are development artifacts, not normal downloads. A release
must pass the gates in the [release policy](docs/RELEASING.md).
