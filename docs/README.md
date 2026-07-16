# Caatuu documentation

This directory contains project-wide documentation. Component-specific setup
and implementation details stay beside the relevant app or tool.

## Start here

| Document | Use it for |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Product surfaces, runtime boundaries, routes, and repository ownership |
| [Development](DEVELOPMENT.md) | Docker startup, tunnel operation, tools, Android work, and validation |
| [Language application contract](LANGUAGE_APP_CONTRACT.md) | Rules separating the shared shell from language-owned behavior |
| [Product readiness](PRODUCT_READINESS.md) | Current release posture and the path to a governed beta |
| [Release policy](RELEASING.md) | Channels, versioning, artifact integrity, and release gates |

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
