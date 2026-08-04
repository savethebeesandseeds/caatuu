# Memory Grove world provenance

The canonical human-readable provenance for the active world lives at
`apps/launcher/static/assets/scenery/metadata/world.provenance.md`. Its logical
layout ID remains `memory-grove-v6`, while its stable physical contract is
`metadata/world.json` and its only runtime terrain image is
`images/terrain-atlas.png`. Logical revisions are JSON metadata, not directory
names. The active world uses schema version 2 and references catalog version 3.

Caatuu Game consumes the world from Caatuu's shared scenery tree; neither the
game nor the launcher owns a second canonical copy. A pinned Linux Godot build
may stage the active catalog, world, and runtime images in an ignored private
project because imported resources must be project-local. That staging is
disposable and is always derived from the hash-locked canonical files.

## Reusable terrain, not a map painting

The active world uses a genuine reusable tile map. It does not slice or
reconstruct an earlier full-map painting. `metadata/world.json` owns a 12 by 12
matrix of tile IDs backed by a 48-entry atlas: four subtle grass bases, eight
reusable environmental accents, every four-bit north/east/south/west packed-
earth path topology, a 16-entry moonstone region family, and four additional
full-court appearances.

The accents add cream and amber flowers, leaf litter, pebbles, two worn-grass
footprints, and cool and warm moss without turning any tile into a unique
scene. Path connectivity and broad terrain regions are explicit, symmetric map
data rather than incidental features baked into one image.

The moonstone family occupies indices 28 through 43. Each index is a four-bit
corner mask with northwest `1`, northeast `2`, southeast `4`, and southwest
`8`; mask `0` is the exact base-grass tile and mask `15` is full stone. The
generator creates broad irregular cream flagstones and softened mortar
deterministically from the established inputs and style palette. It avoids
repeated decorative emblems and a square paving grid, keeping the surface quiet
at phone scale.

Indices 44 through 47 provide extra full-court appearances whose 16-pixel
boundary bands exactly match index 43. Runtime chooses among the canonical
full-court tile and those four variants from a stable logical-coordinate
formula, so streaming order and reloads cannot change the result. Compatible
corner pairs have exact shared edges. This family introduces no additional
source image, third-party material, or license.

## Atlas and streaming contract

`images/terrain-atlas.png` is 832 by 2496 pixels in a 4 by 12 grid. Each
208-pixel cell contains 192 by 192 content pixels and eight edge-extruded pixels
on every side. Runtime UVs sample the content rectangle while the gutters
protect filtered seams. Each tile covers 1 by 1 world unit at 192 content
pixels per world unit.

Runtime chunks contain 3 by 3 tiles. Twelve base-grass padding tiles surround
each authored edge at native density, so the camera safety area does not expose
a square plate or stretched border. With padding, the renderer addresses a 36
by 36 surface divided into 144 chunks; the walker-centered stream window keeps
at most 49 chunks resident.

The independent 36 by 36 navigation grid uses 0.333333-world-unit cells. It
never controls texture density. Terrain remains presentation-only and the fine
grid remains the walkability authority.

The current map records 32 topology IDs across 144 cells: all four grass bases,
seven of eight accents, nine of 16 path topologies, and 12 of 16 moonstone
masks. The renderer additionally exercises all four appended full-court
appearances without duplicating topology in the map data. Forty-six cells form
a substantial authored court from the village well to the trail-sign junction.
Packed earth enters that court through flat, walkable material thresholds, not
raised curbs or new collision geometry.

## Reproducible terrain inputs

The two active source materials are retained flat under `sources/`:

- `sources/terrain-grass.raw.png`, a directly top-down, edge-to-edge
  field of restrained moss and ground cover with no path, object, border,
  perspective, text, or watermark;
- `sources/terrain-earth.raw.png`, directly top-down, edge-to-edge
  softly packed ochre earth with no grass edge, object, footprint, border,
  perspective, text, or watermark.

Both were created with OpenAI's built-in ImageGen workflow on 2026-08-01. The
repository script
`apps/games/caatuu-game/tooling/generate-terrain-tile-atlas.py` performs the
offline deterministic seam healing, restrained color grade, grass and accent
variation, cardinal path masking, corner-mask moonstone regions, irregular
full-court variation with locked boundary bands, eight-pixel edge extrusion,
packing, and optional map preview inside Caatuu's managed Linux image-processing
environment.

`metadata/world.manifest.json` locks the catalog, world, two source materials,
runtime atlas, dimensions, byte lengths, and hashes. The exporter stages only
the explicit runtime allowlist and excludes `sources/` from Godot imports and
release payloads.

## Scale, collision, and movement boundary

Catalog version 3 establishes the runtime humanoid as the common scale
authority: its visible silhouette is 1.4264 world units at model scale 0.78,
and its movement capsule is 1.45 units high with a 0.28-unit radius. Object
heights and collision profiles are calibrated once in `metadata/catalog.json`;
every current placement uses scale 1.0. Solid props use `with-visual` collision
scaling, and collision profiles describe only bottom-center ground contact,
never visible canopies.

The catalog now offers six ordinary Clean Graphic species at true-to-humanoid
heights. The active v6 layout replaces its two former sapling placements with
one oak and one willow at the same positions, preserving the total placement
count and collision intent. The community tree remains the landmark. The moon
sapling stays catalogued with `placement_count: 0` as a dormant rollback asset;
the maple, birch, pine, and poplar are reusable catalog options rather than
additional active placements in this slice.

Caatuu Game string-pulls grid routes only across capsule-clearance,
supercover-validated line-of-sight segments, then applies acceleration,
brake-first reversals, corner and arrival easing, route-distance stall
detection, and movement-speed animation synchronization. Those runtime
behaviors create neither another terrain license nor a second navigation
representation.

## Rights and integrity

The logical world remains `local-preview-only`. Exact catalog, world, atlas,
source, and artifact hashes are locked by `metadata/world.manifest.json` and
`metadata/checksums.sha256`. Canonical repository storage does not assert
copyright ownership or expand the world's license or publication rights.
