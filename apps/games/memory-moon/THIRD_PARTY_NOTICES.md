# Memory Moon third-party notices

## Godot Engine

The build and Web runtime use Godot Engine 4.7.1 under the MIT license. The
full notice is in `GODOT-LICENSE.txt` and is copied beside every generated Web
bundle.

## Quaternius Universal Animation Library

The prototype humanoid and animation clips are from the Quaternius Universal
Animation Library, Standard edition, released under CC0. Caatuu's authoritative
source and notice are:

- `apps/launcher/static/assets/motion/quaternius-standard-v1/source/AnimationLibrary_Godot_Standard.glb`
- `apps/launcher/static/assets/motion/quaternius-standard-v1/source/Quaternius-License.txt`

The exporter verifies these committed files before use and copies the notice
beside the generated Web bundle.

## Caatuu macaw traveler parts atlas

The experimental macaw shell uses only the exact AF-054 parts atlas published
by Caatuu under CC0 1.0:

- `apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/sources/prepared-parts/macaw-traveler-parts-sheet-v1.png`
- SHA-256 `8761ea535ad5d5550989a9c2b9c92e7b163af032f6ed952b3b15024d16378419`

The exporter verifies the source and its package notice before use. The full
dedication is copied beside every generated Web bundle as
`LICENSES/Macaw-Parts-CC0.md`.

## Caatuu Memory Grove preview art

The active Memory Grove v6 scenery uses five exact, semantically renamed
promotions from Caatuu's curated visual-vocabulary folder, ten single-object
images, and straight-down terrain material sources generated with OpenAI's
built-in ImageGen workflow. The generated object set comprises the community
tree, moon bush, moss boulder, dormant moon sapling, and six ordinary trees:
oak, maple, birch, pine, willow, and poplar. The ordinary trees were generated
on 2026-08-02 from the selected Board B Clean Graphic authority, with the trail
sign and village well as secondary references. Their contract requires bold
imperfect brown ink, broad foliage groups, two or three tonal bands,
species-specific silhouettes, and no embedded props or accessories. The stable
non-runtime board is retained as
`sources/tree-style-clean-graphic-reference.png`; the six individual raw tree
outputs are retained beside it. Tukevejtso's Linux process performs chroma
removal, alpha trim, LANCZOS resizing to 420 pixels of visible height, 16-pixel
padding, and binary alpha. A deterministic local process derives four reusable
grass bases, eight flower, leaf, pebble, worn-ground, and moss accents, and the
complete 16-tile cardinal path vocabulary. The same process appends a reusable
16-tile moonstone corner-mask family, derived from those existing inputs and the
documented scenery palette without introducing another source image or license.
It packs all 48 entries in an edge-extruded atlas and authors the grove as a 12
by 12 tile-ID map, including a flat, walkable well-to-junction court. Godot
batches that map into streamed chunks and keeps the fine navigation grid
independent of visible texture density. Collision-safe line-of-sight route
simplification, eased acceleration/braking/corners/arrival, and movement-speed
animation synchronization are runtime behavior and do not add another artwork
dependency. The canonical files live in Caatuu's shared, flattened scenery
tree. Their location under the launcher static tree does not imply launcher
ownership. Runtime art consists only of 15 flat object PNGs and
`images/terrain-atlas.png`; generation inputs live separately under `sources/`
as 20 flat source PNGs and are not runtime dependencies. Godot stages only the
active, hash-verified runtime allowlist into disposable build output, excludes
`sources/`, and does not load archival diamond sheets, raw generation inputs,
or any superseded scenery package. Source and output hashes, dimensions,
processing settings, the schema-v2/catalog-v3 humanoid scale reference,
canonical prop heights, anchors, collision profiles, reuse limits, and rights
state are in:

- `apps/launcher/static/assets/scenery/metadata/catalog.json`
- `apps/launcher/static/assets/scenery/metadata/world.json`
- `apps/launcher/static/assets/scenery/metadata/catalog.manifest.json`
- `apps/launcher/static/assets/scenery/metadata/world.manifest.json`
- `apps/launcher/static/assets/scenery/metadata/catalog.provenance.md`
- `apps/launcher/static/assets/scenery/metadata/world.provenance.md`
- `apps/launcher/static/assets/scenery/metadata/checksums.sha256`

Superseded scenery packages are preserved in Git history rather than the active
asset tree or Web export. Logical IDs such as `memory-moon-style-v1` and
`memory-grove-v6` remain in metadata without becoming physical directory names.
The visual-vocabulary folder does not contain a complete artwork license or
redistribution grant, so the complete active scenery set remains
`local-preview-only` and is stop-ship for public or paid distribution. The
exporter verifies all catalogued runtime PNGs and copies the catalog and world
provenance notes beside the generated Web bundle; no license is inferred by
this notice.
Canonical repository storage likewise does not assert copyright ownership or
expand any license or publication right.
