# Memory Grove v6 provenance

This package's single canonical repository home is
`apps/launcher/static/assets/scenery/memory-grove-v6/`. Memory Moon consumes it
from Caatuu's shared asset catalog; neither the game nor the launcher owns a
second canonical copy. A Linux Godot build may stage the active layout and
terrain into its ignored private project because imported resources must be
project-local. That staging is disposable and is always derived from this
hash-locked package.

Memory Grove v6 now replaces the v5 full-map quad with a genuine reusable tile
map. It does not slice or reconstruct the earlier map painting. The layout owns
a 12 by 12 rectangular matrix of tile IDs backed by a 20-entry atlas: four
subtle grass variants followed by every four-bit north/east/south/west path
topology. Path connectivity is therefore explicit, symmetric map data rather
than an incidental feature baked into a single image.

The atlas is 832 by 1040 pixels in a 4 by 5 grid. Each 208-pixel cell contains
192 by 192 pixels of authored content and eight edge-extruded pixels on every
side. Runtime UVs sample the content rectangle while the gutters protect
filtered seams. Each tile covers 1 by 1 world unit at 192 content pixels per
world unit. Runtime chunks contain 3 by 3 tiles and only chunks within two
chunk coordinates of the walker remain instantiated.

The 36 by 36, 0.333333-unit grid remains independent navigation data. It never
controls texture density. This separation lets a large world add terrain tiles
and chunks without increasing pathfinding or rendering detail accidentally.

Six padding tiles of the base grass entry surround each authored edge at native
density, so the camera safety area does not expose a square plate or stretched
border. With padding, the renderer addresses a 24 by 24 surface divided into 64
chunks; the walker-centered stream window keeps at most 25 chunks resident.

The grass and packed-earth material character originates in the package's
documented ImageGen floor sources. Atlas topology, grass variation, path masks,
gutters, and packing are deterministic local transformations. The current map
uses 16 of the 20 entries across 144 cells, proving repetition rather than a
one-image-per-map migration. Future maps can add or edit tile rows without
changing the chunk renderer, navigation grid, object catalog, or collision
system.

The two retained source materials are:

- `sources/terrain/grass-material-imagegen-v1.png`, generated as a directly
  top-down, edge-to-edge field of restrained moss and ground cover with no path,
  objects, border, perspective, text, or watermark;
- `sources/terrain/earth-material-imagegen-v1.png`, generated as directly
  top-down, edge-to-edge softly packed ochre earth with no grass edge, objects,
  footprints, border, perspective, text, or watermark.

Both were created with OpenAI's built-in ImageGen workflow on 2026-08-01. The
repository script
`apps/games/memory-moon/tooling/generate-terrain-tile-atlas.py` performs the
offline, deterministic seam healing, restrained color grade, grass variation,
cardinal path masking, eight-pixel edge extrusion, packing, and optional map
preview inside Caatuu's managed Linux image-processing environment. The source
and output hashes are locked by `manifest.json`; source files are excluded from
Godot import by `sources/.gdignore`.

Placement scales are normalized by object type so the fixed orthographic camera
does not imply accidental perspective. Collision profiles describe only the
ground-contact footprint at each bottom-center sprite anchor.

The package remains `local-preview-only`; its exact atlas, layout, and catalog
hashes are locked in `manifest.json`. Canonical repository storage does not
assert copyright ownership or expand the package's license or publication
rights.
