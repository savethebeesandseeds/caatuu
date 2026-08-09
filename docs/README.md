# Caatuu documentation

This directory contains project-wide documentation. Component-specific setup
and implementation details stay beside the relevant app or tool.

## Start here

| Document | Use it for |
| --- | --- |
| [Workspace map](WORKSPACE.md) | What belongs in apps, artifacts, tools, archive, and Git |
| [Architecture](ARCHITECTURE.md) | Product surfaces, runtime boundaries, routes, and repository ownership |
| [Development](DEVELOPMENT.md) | Docker startup, tunnel operation, tools, Android work, and validation |
| [Deployment standard](DEPLOYMENT_STANDARD.md) | Provider-neutral release identity, immutable delivery, promotion, rollback, operations, and recovery |
| [Component release validators](COMPONENT_RELEASE_VALIDATORS.md) | Contract ownership, executable release checks, and explicit payload-closure gaps |
| [Language application contract](LANGUAGE_APP_CONTRACT.md) | Rules separating the shared shell from language-owned behavior |
| [Language games and Czech planet plan](GAMES.md) | Content authority, shared game backbone, and detailed plans for the missing Czech planets |
| [Game ownership decision](decisions/0001-game-source-delivery-and-language-ownership.md) | Separation of authored games, generated delivery, language adapters, and Android packaging |
| [Product readiness](PRODUCT_READINESS.md) | Current release posture and the path to a governed beta |
| [Release policy](RELEASING.md) | Channels, versioning, artifact integrity, and release gates |
| [First Android release](FIRST_ANDROID_RELEASE.md) | Planning decisions, signing posture, Play Protect notes, and candidate evidence |

## Governance

| Document | Use it for |
| --- | --- |
| [Licensing](LICENSING.md) | Scope of the project license and separately governed material |
| [Legal inventory](LEGAL_INVENTORY.md) | Component provenance and distribution decisions |
| [Privacy](PRIVACY.md) | Current development-preview data practices |
| [Security](../.github/SECURITY.md) | Vulnerability reporting and support status |
| [Support](../.github/SUPPORT.md) | Support boundaries and reporting channels |
| [Contributing](../.github/CONTRIBUTING.md) | Current contribution policy |

Historical product variants live under [`archive/`](../archive/). Their local
documentation describes the historical implementation; it does not override
the current project-wide contracts here.
