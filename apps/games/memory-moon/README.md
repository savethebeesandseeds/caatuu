# Memory Moon

Memory Moon is Caatuu's browser-first Godot integration spike. The authored
game lives here once; a pinned Linux container exports one Web bundle that the
browser serves and the Android WebView packages unchanged.

The first vertical slice is deliberately small:

- a real Godot 3D scene embedded in the existing Memory Moon panel;
- click/tap destination movement with grid pathfinding, safe line-of-sight
  smoothing, and eased locomotion around scenery;
- a fixed 45-degree-yaw, 30-degree-elevation orthographic camera that follows
  by translation only and preserves a stable 2:1 isometric picture plane;
- one responsive square design viewport that expands into desktop landscape or
  phone portrait without producing a second game build;
- idle and walk animation from Caatuu's existing CC0 Quaternius motion source;
- the logical Memory Grove v6 world slice, loaded from the shared flattened
  scenery tree, with a streamed reusable terrain tile map and 15
  independently reusable illustrated object types;
- a reversible Human/Macaw comparison that attaches the approved macaw parts
  atlas to that same hidden humanoid skeleton;
- four continuous perimeter walls plus fourteen catalogued object footprints,
  without cast shadows or duplicated collision logic;
- Compatibility rendering, single-threaded Web export, and no nested PWA.

The authoritative humanoid remains at
`demos/world-movement/motion-reference/source/AnimationLibrary_Godot_Standard.glb`.
The exporter verifies its SHA-256 and copies it only into its private build
workspace, so the repository does not acquire a duplicate asset.

The macaw shell is an intentionally bounded 2.5D motion-transfer experiment.
The exporter also verifies the exact CC0 AF-054 parts atlas at
`apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/`, mounts
that package read-only, and copies only the atlas into its private Godot
workspace. At runtime Godot removes the declared magenta key in memory and
places nine rigid cards on the humanoid's head, torso, upper/lower-arm, and
lower-leg bones. The leg cards use their reviewed top pivots at the donor's
shins instead of swinging as rigid thigh plates. Each card stays camera-facing
while retaining the projected rotation of its donor bone, so the walk drives
both position and visible limb angle.

This proves that one mature motion source can drive a recognizable character
appearance. It is not AF-056, a finished avian rig, a four-view costume, or a
final-quality solution: the cards are front-facing, rigid, and may expose
seams or humanoid proportions. The Human/Macaw button keeps the donor available
for direct comparison, and a missing atlas or required bone safely falls back
to the humanoid.

The Memory Grove is intentionally independent of that character experiment.
Its logical v6 contract separates a reusable shared object catalog, a fine
navigation grid, and streamed visual terrain. The single canonical scenery
home is `apps/launcher/static/assets/scenery/`; its placement there supplies
Caatuu's common delivery boundary and does not imply launcher ownership.
Memory Moon is a consumer and keeps no canonical scenery copy in its game
directory. Physical storage is intentionally unversioned and shallow: runtime
PNGs are under `images/`, reproducibility inputs under `sources/`, and
contracts under `metadata/`. Logical IDs and revisions remain inside JSON. The
world's 36 by 36 grid supplies 0.333333-unit pathfinding coordinates but never
controls texture density. Visible terrain is a rectangular 12 by 12 map of
reusable tile IDs. Its 48-entry vocabulary contains four low-frequency grass bases, eight
reusable accents (cream and amber flowers, leaf litter, pebbles, two worn-grass
sizes, and cool and warm moss), all 16 north/east/south/west packed-earth path
topologies, a 16-entry moonstone region family, and four additional full-court
appearances. The moonstone entries use
northwest/northeast/southeast/southwest corner occupancy, so broad courts and
their grass transitions are authored as reusable topology rather than as a
one-off painting. Each tile spans 1 world unit and each runtime chunk batches 3
by 3 tiles into one surface. A 12-tile grass safety ring extends the camera area
without stretching the map edge. The fixed camera alone supplies the 2:1
isometric projection.

The current layout uses that region family for a substantial cream-stone court
from the village well to the trail-sign junction. Its broad irregular
flagstones and softened mortar take their palette from those two landmarks
without repeating a square paving grid or decorative emblem. Full-court cells
select one of five seam-compatible appearances from their logical coordinate,
so chunk reload order never changes the map. The points where packed earth enters the court are
deliberately flat, walkable material thresholds: they add no curb, collision,
or separate movement rule.

The 832 by 2496 atlas is a 4 by 12 grid of 208-pixel cells. Every cell contains
192 by 192 content with an eight-pixel edge-extruded gutter, and runtime UVs
sample only the content. The authored map records 32 topology IDs while the
renderer also exercises the four additional full-court appearances. Repetition
is intentional and makes expansion a tile-row edit. With padding,
the 36 by 36 rendered area contains 1,296 tiles and forms 144 chunks. At most 49
chunks within the configured radius around the walker remain instantiated, so
expanding the map adds compact map data rather than another full-map painting
or one node per navigation cell.

Eighteen purposeful placements reuse ten of the 15 transparent catalog object
types: the community tree, village well, trail sign, street lamp, flowers,
stump, moon bush, moss boulder, oak, and willow. The oak and willow occupy the
two former sapling positions, so placement counts and navigation intent remain
stable. The moon sapling remains catalogued but dormant at placement count zero
for safe rollback; maple, birch, pine, and poplar are ready for later maps.

Five catalog objects are exact, semantically renamed promotions from the
repository's visual-vocabulary authority. Ten are single-object ImageGen
outputs prepared in the existing Tukevejtso Linux environment: the community
tree, moon bush, moss boulder, dormant moon sapling, and six ordinary tree
species. The ordinary trees adopt the selected Board B Clean Graphic style,
using the trail sign and village well as secondary authorities. They favor bold
imperfect brown ink, broad foliage groups, two or three tonal bands, and
species-specific silhouettes, with no embedded props or accessories. The
selected non-runtime board is retained at
`apps/launcher/static/assets/scenery/sources/tree-style-clean-graphic-reference.png`.
Their canonical runtime forms are the 15 flat PNGs in
`apps/launcher/static/assets/scenery/images/`.

`apps/launcher/static/assets/scenery/metadata/catalog.json` records
projection, palette, source materials, scale ranges, anchors, collision shape
descriptors, occlusion, and reuse policy. Schema version 2 and catalog version 3
also record the runtime humanoid as the scale authority: its measured visible
silhouette is 1.4264 world units at model scale 0.78, while its movement capsule
is 1.45 units high and 0.28 units in radius. Prop defaults are canonical heights
relative to that reference. The ordinary tree heights are oak 4.4, maple 4.2,
birch 4.5, pine 5.1, willow 4.3, and poplar 5.2 world units. Every v6 placement
uses scale 1.0, and every solid prop scales its collision footprint with its
visual instance.
`apps/launcher/static/assets/scenery/metadata/world.json` independently
owns the navigation grid, reusable-tile atlas contract, tile-index rows,
streaming settings, placements, boundaries, spawn point, and critical routes. Its
world manifest locks `images/terrain-atlas.png` at 192 content pixels per world
unit and records its source and integrity contract. The catalog manifest
independently locks the reusable object images and their sources. Flat strict
schemas, two provenance documents, `checksums.sha256`, and the local-preview
rights gate make the chain auditable. The shared `metadata/registry.json`
records the logical `memory-moon-style-v1` catalog and `memory-grove-v6` world
as the active pair.
Superseded scenery packages are preserved in Git history rather than the served
asset tree.

The grove deliberately avoids a perspective orbit. Its camera stays at 45
degrees of yaw and 30 degrees of elevation while responsive orthographic height
keeps the walker readable on desktop and phone. The dead zone operates in
camera-ground axes, while smooth subpixel translation avoids stepped camera
motion. Every object card shares the fixed picture-plane yaw, keeps
depth testing enabled, and writes its cutout depth; the character can therefore
pass naturally in front of or behind scenery without per-frame billboarding.
The walker uses a capsule body and click paths over the logical grid. Greedy
string-pulling removes cell-center stair-steps only when a capsule-clearance
supercover check proves the shortcut stays in bounds, crosses no blocked cell,
and does not squeeze diagonally through a blocked corner. The grid is
blocked from the same fourteen catalog-selected object footprints and four
perimeter strips used by physics, so routes avoid obstacles before the capsule
reaches them. Collision geometry describes ground contact—tree platforms,
trunks, posts, stone rings, bushes, and rocks—rather than sprite canopies.
Flowers and terrain remain presentation-only.

Locomotion follows those safe segments with acceleration and braking instead of
instant full-speed starts and stops. It slows before sharp corners and direction
reversals, derives its arrival speed from remaining route distance, caps each
physics step at the current waypoint, and replans when remaining route distance
fails to improve during the stall window. The
Walk animation speed follows actual movement speed and blends back to Idle on
arrival, keeping feet and translation synchronized through starts, turns, and
stops.

The Godot project has one 540 by 540 authored viewport, a 960 by 540 desktop
window override, and `expand` stretch behavior. The host preserves a 16:9 game
stage on wider screens and gives the embedded game the remaining safe viewport
height in phone portrait. The world surface accepts the same click or tap
gesture on desktop, browser touch, and Android; only reset and appearance remain
buttons. Android loads this exact Web export with a wide viewport instead of
maintaining a separate native game implementation.

The world and HUD render directly into Godot's native root viewport. There is
no reduced-resolution intermediate buffer or nearest-neighbor upscale; desktop
and phone therefore share the same full-resolution render and native input
tree.

## Export and run

Run from the repository root:

```bash
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker compose --profile game-tools-provision build memory-moon-godot-provision
docker compose --profile game-tools-provision run --rm memory-moon-godot-provision
docker compose --profile game-tools build memory-moon-godot-export
docker compose --profile game-tools run --rm memory-moon-godot-export
docker compose up -d caatuu
```

Then open:

```text
http://127.0.0.1:8765/cz/index.html?game=memory-moon
```

The generated bundle is written to
`apps/languages/czech/static/games/memory-moon/godot-v1/`. It is intentionally
ignored because it is reproducible build output. The directory remains
versioned for incompatible releases. During local iteration, the Caatuu service
worker fetches Memory Moon payloads network-first so a newly exported `.wasm`
or `.pck` cannot be hidden by a stale preview cache.

Godot is never installed on the Windows host. The provisioner resumably fetches
the verified official editor and reads only the single-threaded Web template
from the all-platform archive using HTTP ranges. The export container has no
network at runtime, runs as a non-root user, and receives the provisioned
toolchain, project, reference assets, and canonical flattened scenery tree
read-only. Because Godot imports only project-local resources, the exporter
stages the minimum active, hash-verified subset: `metadata/catalog.json`,
`metadata/world.json`, and their referenced PNGs under `images/`. It stages
them inside its ignored private project workspace and excludes `sources/`
entirely. That copy is disposable build output and never another asset home.
