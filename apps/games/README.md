# Caatuu Games

This directory owns authored, language-independent game implementations and
the standalone art experiments in `lab/`.
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

## Local art labs

Open <http://127.0.0.1:8765/games/lab> to discover the experiments. The lab
runs outside the Godot game and uses the established local service and port,
gated by `ENABLE_CAATUU_GAME_PREVIEW=1`. Its pages are `noindex` and are not
part of application, Android or Godot exports.

| Experiment | Stable local URL | Source |
| --- | --- | --- |
| Lab hub | `/games/lab` | `apps/games/lab/index.html` |
| Motion | `/games/lab/motion` | [Curated character workshop](caatuu-game/character-workshop/README.md) |
| Scenery | `/games/lab/scenary` | `apps/games/lab/scenary/` |

The URL spelling is deliberately `scenary`. Both experiments also accept a
trailing slash. Motion serves the tracked viewer, manifest and 55 selected
frames directly; no export or publisher step is needed to review a source
change. The former long workshop entry redirects to `/games/lab/motion`,
and its asset URLs remain compatible.

Scenery reuses the canonical `/assets/scenery/metadata/{catalog,world}.json`
and `/assets/scenery/images/` assets, plus the same Motion manifest and frames.
Click a destination to move the macaw; no arrow-key control is needed. A route
shorter than 2.6 world units selects walking at 1.55 units per second; longer
routes select running at 3.6 units per second. This is a movement experiment,
separate from Godot actor integration or approval of a final game world.

## Game ownership and release boundary

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
