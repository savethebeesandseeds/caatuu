# Caatuu Games

This directory owns authored, language-independent game implementations.
Generated browser and Android payloads are delivery artifacts, not source, and
belong under the ignored `artifacts/games/` tree.

The ownership split is:

| Concern | Authority |
| --- | --- |
| Game source and engine configuration | `apps/games/<game-id>/` |
| Game identity and build contract | `apps/games/<game-id>/game.json` |
| Repository game index | `apps/games/catalog.json` |
| Generated Web export | `artifacts/games/<game-id>/web/<release-id>/` |
| Browser route | `/games/<game-id>/<release-id>/` |
| Localized host presentation and curriculum hooks | `apps/languages/<language>/.../game-adapters/` |
| Android selection and packaging | `apps/android/` |

Language adapters may select and describe a game. They must not declare engine
versions, source paths, build containers, artifact authorities, or shared asset
ownership.

Adapter JSON files are reviewed governance metadata, not runtime-loaded
configuration. The language host remains the executable presentation for now,
and contract tests must keep its title, description, loading text, icon,
enabled platforms, and manifest-owned neutral game route aligned with the
adapter and game manifest.

`local-preview-only` games remain available for local development, but the
public tunnel, public debug APK publisher, and Android release packaging fail
closed until the schema-valid catalog contains every delivered game exactly
once and each game, dependency, and machine-readable authority is
release-cleared. Check the catalog with
`node apps/games/tooling/check-release-readiness.mjs --surface <name> --require-game memory-moon`.

Validate the catalog and adapters from the canonical Caatuu development
container:

```bash
docker exec -w /workspace caatuu-dev \
  node apps/games/test/game-catalog-contract.test.mjs
```
