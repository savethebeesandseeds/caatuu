# Shared scenery assets

This directory is Caatuu's single canonical repository home for active scenery
images, their exact generation inputs, and the metadata needed to render,
validate, and reproduce them. It is served locally below `/assets/scenery/`.
Its physical location under `apps/launcher/static/assets/` establishes a shared
delivery boundary; it does not assign ownership to the launcher.

## Directory map

The tree is deliberately shallow and contains no version-named package
directories:

```text
scenery/
|-- README.md
|-- images/                         # Runtime PNGs only
|   |-- community-tree.png
|   |-- flower-patch.png
|   |-- moon-bush.png
|   |-- moon-sapling.png
|   |-- moss-boulder.png
|   |-- street-lamp.png
|   |-- terrain-atlas.png
|   |-- trail-sign.png
|   |-- tree-birch.png
|   |-- tree-maple.png
|   |-- tree-oak.png
|   |-- tree-pine.png
|   |-- tree-poplar.png
|   |-- tree-stump.png
|   |-- tree-willow.png
|   `-- village-well.png
|-- sources/                        # Non-runtime reproducibility inputs
|   |-- community-tree.raw.png
|   |-- floor-atlas.derived.png
|   |-- floor-earth-packed.derived.png
|   |-- floor-earth-packed.raw.png
|   |-- floor-grass-flowers.derived.png
|   |-- floor-grass-flowers.raw.png
|   |-- floor-grass-moss.derived.png
|   |-- floor-grass-moss.raw.png
|   |-- moon-bush.raw.png
|   |-- moon-sapling.raw.png
|   |-- moss-boulder.raw.png
|   |-- terrain-earth.raw.png
|   |-- terrain-grass.raw.png
|   |-- tree-birch.raw.png
|   |-- tree-maple.raw.png
|   |-- tree-oak.raw.png
|   |-- tree-pine.raw.png
|   |-- tree-poplar.raw.png
|   |-- tree-style-clean-graphic-reference.png
|   `-- tree-willow.raw.png
`-- metadata/                       # Contracts, integrity, and provenance
    |-- registry.json
    |-- catalog.json
    |-- world.json
    |-- catalog.manifest.json
    |-- world.manifest.json
    |-- catalog.provenance.md
    |-- world.provenance.md
    |-- catalog.schema.json
    |-- world.schema.json
    |-- floor.processing.json
    `-- checksums.sha256
```

### `images/`: what the game may render

`images/` is the complete human-browsable runtime art inventory: 15
independently reusable transparent object images and one reusable terrain
atlas, for 16 runtime images in total. A PNG outside this directory is not a
runtime scenery asset. The active world contains no full-map painting and no
second copy of any runtime image.

### `sources/`: how generated art can be reproduced

`sources/` contains retained raw ImageGen inputs and deterministic derived
intermediates used to reproduce the processed objects and terrain. These files
may include authoring backgrounds, higher-resolution material detail, prepared
floor tiles, or an intermediate floor atlas and must never be loaded by the
game. The exporter stages an explicit runtime allowlist and excludes the entire
`sources/` directory from Godot imports and release payloads. Source identity,
hashes, transformations, and tool settings are recorded in the manifests and
provenance documents.

Reviewed images promoted from `../visual-vocabulary/` do not need an additional
raw copy under `sources/`: the promoted semantic PNG lives in `images/`, while
`catalog.manifest.json` locks it to the authority path and SHA-256.

The active object catalog contains five exact promotions and ten generated
objects. The generated set comprises the community tree, moon bush, moss
boulder, dormant moon sapling, and six ordinary tree species. The ordinary
trees use the selected Clean Graphic contract: bold imperfect brown ink, broad
foliage groups, two or three tonal bands, and a distinct species silhouette,
without embedded stones, signs, ornaments, or other accessories.

The stable, non-runtime style authority is retained as
`sources/tree-style-clean-graphic-reference.png`. The six tree raw outputs and
all other generation inputs remain beside it. There are 20 flat PNGs in
`sources/`; none is loaded by the game.

### `metadata/`: what every file means

- `registry.json` names the active logical catalog and world and points
  consumers to their stable files.
- `catalog.json` owns reusable object identity, texture path, scale, anchor,
  collision, occlusion, reuse, and source identity.
- `world.json` owns terrain tile rows, placements, navigation, boundaries,
  spawn points, critical routes, and streaming settings.
- `catalog.manifest.json` and `world.manifest.json` lock the corresponding
  documents, images, inputs, dimensions, byte lengths, and SHA-256 values.
- `catalog.provenance.md` and `world.provenance.md` explain derivation, visual
  intent, rights, and publication limits for humans.
- `catalog.schema.json` and `world.schema.json` are the strict validation
  contracts for the two independent JSON documents.
- `floor.processing.json` preserves the deterministic preparation record for
  the retained floor-material inputs; it is not a runtime floor definition.
- `checksums.sha256` is the tool-friendly integrity list for the canonical
  files. The manifests remain the semantic source of truth.

The reusable catalog and map-specific world intentionally remain separate.
Several worlds may reuse the same catalog without copying its images or
changing object metadata.

The active pair uses schema version 2, catalog version 3, and the logical
`memory-grove-v6` layout.

## Logical versions, not version folders

Logical IDs such as `memory-moon-style-v1` and `memory-grove-v6`, plus their
schema and content revisions, remain inside JSON where validators can inspect
them. They are not physical directory names. Content hashes and Git history
provide rollback and auditability; superseded packages do not remain in the
served asset tree.

## Active terrain contract

`metadata/world.json` maps a 12 by 12 authored grid to the 48-entry
`images/terrain-atlas.png` vocabulary: four grass bases, eight botanical and
worn-ground accents, 16 cardinal packed-earth path topologies, 16 corner-mask
moonstone region tiles, and four seam-compatible full-court variants. Each
atlas cell contains 192 by 192 content pixels with an eight-pixel extruded
gutter and covers one world unit.

The 36 by 36 fine grid remains authoritative for navigation. Terrain is
presentation-only: a path color, stone threshold, or flower accent creates no
collision or second walkability map.

## Consumer and build rules

Memory Moon consumes this canonical tree; it does not own a persistent copy
inside its Godot project. The pinned Linux exporter verifies manifests and
checksums, stages only `metadata/catalog.json`, `metadata/world.json`, and the
referenced runtime files from `images/` into an ignored private workspace, and
then runs the scenery verifier. It never stages `sources/`. That staging is
disposable build output.

When changing scenery:

1. add or replace the single canonical runtime PNG in `images/`;
2. retain any required generation input in `sources/`;
3. update the owning catalog or world document;
4. update its manifest, provenance, and `checksums.sha256`;
5. validate both schemas and run the containerized scenery/export checks.

Do not add another canonical asset tree under a game, create a version folder,
or point runtime metadata directly at `visual-vocabulary` or `sources`.

## Rights boundary

Canonical repository storage describes where Caatuu maintains a file; it does
not assert copyright ownership or expand a license. The provenance and
per-source rights fields are normative. Assets marked `local-preview-only`
remain blocked from public or paid distribution until the documented release
condition is satisfied.
