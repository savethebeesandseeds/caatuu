# Memory Grove v1 provenance

Fourteen of these twenty-seven catalogued images are reviewed derivatives
of Caatuu's archival visual-vocabulary sheets:

- `burrow_space_mystic_trees_deciduous_01.png`
- `burrow_space_mystic_trees_specialty_01.png`
- `burrow_space_mystic_ground_grass_tiles_01.png`
- `burrow_space_mystic_ground_grass_transitions_01.png`

The originals remain in
`apps/launcher/static/assets/visual-vocabulary/originals/`; they were not
modified. The derivatives were produced with Tukevejtso's object-aware
`sprite-split` workflow using a 4 by 4 guide, 32 pixels of crop padding, and
dark-background masking. The complete run produced 32 sprites and an empty
warning list. Only six visually inspected sprites were promoted here.

The ground pass used the same isolated workflow with zero crop padding so
adjacent isometric diamonds can meet without transparent seams. It also
produced 32 sprites with an empty warning list. Eight reviewed grass, flower,
and dirt-path tiles then passed through Tukevejtso's targeted edge-connected
transparency helper (black target, tolerance 8, 4-connectivity, minimum area 0)
to remove only the source sheet's baked black diamond outline. Between 1,794
and 1,825 edge-connected pixels were cleared per selected tile; interior RGBA
pixels and dimensions were preserved. The cleaned derivatives were promoted
into `ground-tiles/`; the raised street tiles remain deferred because their
baked curbs require a dedicated road layout.

The four walkable-boundary cards were generated on 2026-07-31 with OpenAI's
built-in ImageGen workflow. The prompt family requested lightweight 2.5D
classic-RPG scenery on a flat `#ff00ff` background: connected olive-green shrub
banks and connected mossy rock embankments, each in a horizontal east-west and
a portrait north-south orientation. All four omit cast shadows, text, and
isolated props. `canopy.png` supplied the foliage-style reference and
`ground-tiles/meadow-lush.png` supplied the palette and viewing-angle reference
for the horizontal pair; those reviewed cards then anchored the style and
materials of the vertical pair.

The generated chroma sources remain unchanged in the isolated Tukevejtso
workspaces
`C:/Work/tukevejtso/linux/workspaces/images/memory-moon-boundaries-v1-20260731/originals/`
and
`C:/Work/tukevejtso/linux/workspaces/images/memory-moon-boundaries-v2-vertical-20260731/originals/`.
The ImageGen skill's `remove_chroma_key.py` helper selected the border key,
applied a soft matte with transparent threshold 12 and opaque threshold 220,
and enabled despill. Each result was then cropped to its visible alpha bounds
with 16 transparent pixels of safety padding. The vertical cards were also
downscaled to a 1,024-pixel maximum height before promotion, preserving ample
detail while reducing Web texture memory. The reviewed outputs were promoted
as the horizontal and `-vertical` bush and rock PNGs under `boundaries/`.

## Scenery v2 visual redesign

The earlier eight isometric ground diamonds and four elongated boundary cards
remain catalogued above for reproducibility, but are retired from the active
runtime. Their large transparent silhouettes caused a dominant diagonal grid,
and the portrait boundary cards read as upright cones rather than map edges.

The active v2 presentation uses nine generated images: one opaque baked ground
map; four ordinary tree redraws (ancient hollow, broad canopy, willow, and
columnar); two compact bush clusters; and two compact mossy-rock clusters. They
were generated on 2026-07-31 with OpenAI's built-in ImageGen workflow using the
reviewed `starlight.png` and `lantern-bloom.png` trees as painterly style
anchors. The ground prompt requested a pure overhead, cool-green moonlit grove
with a bottom entrance, a central clearing, three asymmetric destination paths,
fine terrain detail, and no props, shadows, UI, text, grid lines, or isometric
diamonds. The tree prompts requested distinct silhouettes in the same cool
teal, jade, pine, and moss palette, on a flat `#ff00ff` chroma background with
no cast shadows. The prop prompts requested varied low, broad clusters on that
same background, explicitly excluding conical hedges, cliffs, and pillars.

The generated originals and reviewed derivatives are preserved in
`C:/Work/tukevejtso/linux/workspaces/images/memory-moon-scenery-v2-20260731/`.
The ImageGen chroma helper ran inside the existing Tukevejtso Linux container
with automatic border-key selection, soft matte, thresholds 12 and 220, and
despill. Tree and prop outputs were alpha-trimmed, padded by 24 transparent
pixels, and downscaled to a 1,024-pixel maximum dimension. The ground was
normalized to an opaque 1,024 by 1,024 map. The runtime draws that map once,
places the four v2 ordinary trees alongside the two archival magical landmarks,
and alternates the four compact cluster variants around the four existing
continuous collision walls.

The manifest records source hashes or generation metadata, source cells where
applicable, output dimensions, and output hashes. The bundle remains a local
preview asset until publication permission for its archival source sheets is
recorded in Caatuu's legal inventory; this file does not infer or grant a
separate license.
