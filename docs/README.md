# Caatuu documentation

This directory contains project-wide documentation. Component-specific setup
and implementation details stay beside the relevant app or tool.

## Start here

| Document | Use it for |
| --- | --- |
| [Workspace map](WORKSPACE.md) | What belongs in apps, artifacts, tools, archive, and Git |
| [Architecture](ARCHITECTURE.md) | Product surfaces, runtime boundaries, routes, and repository ownership |
| [Development](DEVELOPMENT.md) | Local Docker/tooling operations, Android work, and validation |
| [Deployment standard](DEPLOYMENT_STANDARD.md) | Provider-neutral release identity, immutable delivery, promotion, rollback, operations, and recovery |
| [Static web hosting](STATIC_WEB_HOSTING.md) | Pages, Release assets, reporting Worker, DNS, validation, and rollback |
| [Component release validators](COMPONENT_RELEASE_VALIDATORS.md) | Contract ownership, executable release checks, and explicit payload-closure gaps |
| [Language application contract](LANGUAGE_APP_CONTRACT.md) | Rules separating the shared shell from language-owned behavior |
| [Language games and Czech planet plan](GAMES.md) | Content authority, shared game backbone, and detailed plans for the missing Czech planets |
| [Course content quality plan](COURSE_CONTENT_QUALITY_PLAN.md) | Scope, acceptance criteria and checkpoints for improving enabled course/game content to 85/100 |
| [Current content execution plan](COURSE_CONTENT_EXECUTION_PLAN.md) | Content-only checkpoints, preserved gameplay and unchanged scoring gates |
| [Retained content grading review](COURSE_CONTENT_RETAINED_REVIEW.md) | Item-level grading evidence, level counts and remaining review gaps |
| [Word World contextual hint review](WORD_WORLD_CONTEXT_REVIEW.md) | Reviewed expression and grammar hints, preservation proof and delivery checks |
| [Course content gameplay recovery](COURSE_CONTENT_GAMEPLAY_RECOVERY.md) | Selective repair, preserved content, recovery snapshot and verification evidence |
| [Image retrieval and databases](IMAGE_RETRIEVAL_AND_DATABASES.md) | Shared artwork embeddings, course data ownership, generation and validation |
| [Game content catalogs](GAME_CONTENT_CATALOGS.md) | Normalized runtime filenames, difficulty selection, inventory and recovery evidence |
| [Game ownership decision](decisions/0001-game-source-delivery-and-language-ownership.md) | Separation of authored games, generated delivery, language adapters, and Android packaging |
| [Product readiness](PRODUCT_READINESS.md) | Current release posture and the path to a governed beta |
| [First Android release map](RELEASE_MAP.md) | Ordered product, content, packaging, legal, business, testing, and Play gates for `v0.1.0` |
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
