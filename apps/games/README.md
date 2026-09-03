# Caatuu Games

This directory owns authored, language-independent game implementations.
Generated browser payloads are delivery artifacts, not source, and
belong under the ignored `artifacts/games/` tree.

The ownership split is:

| Concern | Authority |
| --- | --- |
| Game source and engine configuration | `apps/games/<game-id>/` |
| Game identity and build contract | `apps/games/<game-id>/game.json` |
| Repository game index | `apps/games/catalog.json` |
| Generated Web export | `artifacts/games/<game-id>/web/<release-id>/` |
| Browser route | `/games/<game-id>/<release-id>/` |
| Optional embedded-game adapter | `apps/languages/<language>/.../game-adapters/` |

An embedded game may later gain a language adapter that selects and describes
it. Such adapters must not declare engine versions, source paths, build
containers, artifact authorities, or shared asset ownership.

Adapter JSON files, when present, are reviewed governance metadata rather than
runtime-loaded configuration. Standalone games have no host adapter or parent
window protocol.

`local-preview-only` games are available only when their server preview feature
is explicitly enabled. Application and Android releases omit them. Any future
public static host for a game must fail closed until the schema-valid catalog
contains the selected game exactly once and each dependency and machine-readable
authority is release-cleared. Check an intended game publication with
`node apps/games/tooling/check-release-readiness.mjs --surface <name> --require-game caatuu-game`.

The current `caatuu-game` manifest is standalone and browser-only. It has no
language adapter, is not embedded by a language application, and is not copied
into the Android package. Memory Moon is an unrelated static placeholder in the
Czech application's Games screen.

Validate the catalog and adapters from the canonical Caatuu development
container:

```bash
docker exec -w /workspace caatuu-dev \
  node apps/games/test/game-catalog-contract.test.mjs
```
