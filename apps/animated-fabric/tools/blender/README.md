# AF-052 bounded directional prerender

This directory owns the complete Blender source for one fixed low-poly humanoid and one analytical
in-place walk. The worker constructs the twelve motion samples once, keeps one orthographic camera
fixed, and changes only actor-root yaw to rerender `SE`, `SW`, `NE`, and `NW`. It does not load a
`.blend`, model, texture, motion file, add-on, font, or project-provided script, and it never
transforms a finished 2D frame to fabricate another direction.

The original evidence boundary is recorded in
[decision 0010](../../docs/decisions/0010-experimental-blender-prerender.md); the narrow product
promotion is [decision 0012](../../docs/decisions/0012-directional-yaw-prerender.md). Blender image
details and licensing are in the [container README](../../containers/blender/README.md) and
[third-party record](../../docs/third-party/blender.md).

## Source split

- `motion.py` is standard-library-only and defines every sampled joint, foot contact, event,
  direction yaw, duration, frame-sequence value, directional manifest, and stable motion digest.
- `render_walk.py` is the only module that imports Blender APIs. It constructs owned geometry,
  applies each immutable pose once before its four yaw renders, validates RGBA and alpha bounds,
  compares direct left-facing views with mirrors, and transactionally publishes evidence.
- `scripts/package_blender_directional_export.py` runs later in `animated-fabric-dev`. It verifies
  the evidence before and after packing, invokes the shared AF-051 grid packer, verifies every
  product cell against its source, and atomically publishes one PNG and one JSON document.
- `scripts/verify_blender_directional_goldens.py` compares decoded pixels with four reviewed
  phase-zero goldens and independently recomputes direct-view versus mirror differences.
- `scripts/package_blender_walk_demo.py` creates a contact sheet and synchronized GIF for human
  review from the same verified source sequence.

Only `render_walk.py` requires `bpy`. The motion, evidence, packaging, and golden contracts run in
the ordinary Linux development image.

## Run the complete path

All commands run from `apps/animated-fabric`. Docker performs productive work in Linux; no Python,
Blender, Pillow, or image dependency is installed on Windows.

```powershell
docker compose --profile blender config --quiet
docker compose --profile blender build animated-fabric-blender
docker compose --profile blender run --rm --no-deps animated-fabric-blender
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/verify_blender_directional_goldens.py `
  --source workspaces/blender/af052-demo
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/package_blender_directional_export.py `
  --source workspaces/blender/af052-demo `
  --out workspaces/blender/af052-product
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/package_blender_walk_demo.py `
  --source workspaces/blender/af052-demo `
  --out workspaces/blender/af052-demo/review
```

The worker writes exactly 50 hashed evidence files, capped at 4 MiB, plus its adjacent provenance
document. Product and review directories are separate derived outputs:

```text
workspaces/blender/
|-- af052-demo/
|   |-- directional-prerender.json
|   |-- provenance.json
|   |-- walk/
|   |   |-- animation.json
|   |   |-- SE/000.png ... 011.png
|   |   |-- SW/000.png ... 011.png
|   |   |-- NE/000.png ... 011.png
|   |   `-- NW/000.png ... 011.png
|   `-- review/
|       |-- walk_contact_sheet.png
|       `-- walk_review.gif
`-- af052-product/
    |-- walk.png
    `-- walk.spritesheet.json
```

`workspaces/blender/` is untracked. `walk/animation.json` uses the strict
`animated-fabric.frame-sequence.v1` contract. The adjacent
`animated-fabric.directional-prerender.v1` document is mandatory: it identifies the fixed source,
one motion digest, the `actor_root_yaw` strategy, and the exact ordered yaw map. The product package
is intentionally not the general project-based `ExportProject` path and supports only this owned
`walk`.

The provenance schema and its `AF-044` ticket field remain the historical evidence identity.
AF-052 adds the directional manifest and product boundary rather than silently rewriting old
evidence semantics.

## Repeatability check

Render a second fresh destination, verify its goldens, and package it into a second sibling product
directory:

```powershell
docker compose --profile blender run --rm --no-deps animated-fabric-blender `
  --out /output/af052-repeat
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/verify_blender_directional_goldens.py `
  --source workspaces/blender/af052-repeat
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/package_blender_directional_export.py `
  --source workspaces/blender/af052-repeat `
  --out workspaces/blender/af052-product-repeat
```

Compare both `walk/` trees, both directional and provenance documents, and both product directories
recursively. The worker removes volatile PNG ancillary chunks without re-encoding pixels, so two
runs in one pinned environment are byte-repeatable. Cross-host encoded bytes are measured rather
than assumed; reviewed goldens compare decoded RGBA pixels with an explicit tolerance.

The authoritative evidence run is native x86-64 Linux. Docker Desktop is a convenience smoke only.
`provenance.json` intentionally contains no timestamp, hostname, host path, elapsed time, or
container ID. The path-scoped `animated-fabric-blender-evidence.yml` workflow repeats the isolated
build, two renders, golden checks, packaging, recursive comparison, hashes, and focused contracts on
native Ubuntu without changing the normal quality gate or publishing internal artifacts.
