# Memory Moon

Memory Moon is Caatuu's browser-first Godot integration spike. The authored
game lives here once; a pinned Linux container exports one Web bundle that the
browser serves and the Android WebView packages unchanged.

The first vertical slice is deliberately small:

- a real Godot 3D scene embedded in the existing Memory Moon panel;
- click/tap destination movement with grid pathfinding around scenery;
- a fixed 45-degree-yaw, 30-degree-elevation orthographic camera that follows
  by translation only and preserves a stable 2:1 isometric picture plane;
- one responsive square design viewport that expands into desktop landscape or
  phone portrait without producing a second game build;
- idle and walk animation from Caatuu's existing CC0 Quaternius motion source;
- a data-driven Memory Grove v6 world slice with a streamed reusable terrain
  tile map and nine independently reusable illustrated object types;
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
Scenery v6 separates an immutable shared object catalog, a fine navigation
grid, and streamed visual terrain. The single canonical scenery home is
`apps/launcher/static/assets/scenery/`; its placement there supplies Caatuu's
common delivery boundary and does not imply launcher ownership. Memory Moon is
a consumer and keeps no canonical scenery copy in its game directory. Its 36
by 36 grid supplies 0.333333-unit pathfinding coordinates but never controls
texture density. Visible terrain is a rectangular 12 by 12 map of reusable tile
IDs. Its 20-entry vocabulary contains four low-frequency grass variants and all
16 north/east/south/west packed-earth path topologies, so routes join by data
rather than being painted into one map-sized image. Each tile spans 1 world
unit and each runtime chunk batches 3 by 3 tiles into one surface. A six-tile
grass safety ring extends the camera area without stretching the map edge. The
fixed camera alone supplies the 2:1 isometric projection.

The 832 by 1040 atlas is a 4 by 5 grid of 208-pixel cells. Every cell contains
192 by 192 content with an eight-pixel edge-extruded gutter, and runtime UVs
sample only the content. The current authored map uses 16 of the 20 tile types;
repetition is intentional and makes expansion a tile-row edit. With padding,
the 24 by 24 rendered area contains 576 tiles and forms 64 chunks. At most 25
chunks within the configured radius around the walker remain instantiated, so
expanding the map adds compact map data rather than another full-map painting
or one node per navigation cell.

Eighteen purposeful placements reuse nine transparent object types: one
community tree, a village well, a trail sign, a street lamp, flowers, a stump,
a moon bush, a moss boulder, and a sapling. Six are exact, semantically renamed
promotions from the repository's visual-vocabulary authority; three are new
single-object ImageGen outputs prepared in the existing Tukevejtso Linux
environment. Their canonical runtime forms live only under
`apps/launcher/static/assets/scenery/memory-moon-style-v1/`.

`apps/launcher/static/assets/scenery/memory-moon-style-v1/catalog.json` records
projection, palette, source materials, scale ranges, anchors, collision shape
descriptors, occlusion, and reuse policy.
`apps/launcher/static/assets/scenery/memory-grove-v6/layout.json` independently
owns the navigation grid, reusable-tile atlas contract, tile-index rows, streaming
settings, placements, boundaries, spawn point, and critical routes. Its
manifest locks tile content at 192 pixels per world unit and records tile,
chunk, hash, source, and render contracts. Strict v2 schemas, manifests, source
and artifact hashes, and the local-preview rights gate make the chain auditable.
The earlier v1, v3, v4, and v5 packages remain as excluded design history.

The grove deliberately avoids a perspective orbit. Its camera stays at 45
degrees of yaw and 30 degrees of elevation while responsive orthographic height
keeps the walker readable on desktop and phone. The dead zone operates in
camera-ground axes, while smooth subpixel translation avoids stepped camera
motion. Every object card shares the fixed picture-plane yaw, keeps
depth testing enabled, and writes its cutout depth; the character can therefore
pass naturally in front of or behind scenery without per-frame billboarding.
The walker uses a capsule body and click paths over the logical grid. The grid
is blocked from the same fourteen catalog-selected object footprints and four
perimeter strips used by physics, so routes avoid obstacles before the capsule
reaches them. Collision geometry describes ground contact—tree platforms,
trunks, posts, stone rings, bushes, and rocks—rather than sprite canopies.
Flowers and terrain remain presentation-only.

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
toolchain, project, reference assets, and canonical scenery catalog read-only.
Because Godot imports only project-local resources, the exporter stages the
minimum active, hash-verified scenery subset inside its ignored private project
workspace. That copy is disposable build output and never another asset home.
