# AF-044 procedural 3D walk spike

This directory owns the complete source for the bounded Blender feasibility experiment. It creates
one low-poly articulated humanoid from primitives, evaluates one analytical in-place walk, keeps a
single orthographic camera fixed, and rotates the actor root to render `SE`, `SW`, `NE`, and `NW`.
It does not load a `.blend`, model, texture, motion file, add-on, font, or project-provided script.

The boundary and promotion rules are recorded in
[decision 0010](../../docs/decisions/0010-experimental-blender-prerender.md). Blender image details
and licensing are in the [container README](../../containers/blender/README.md) and
[third-party record](../../docs/third-party/blender.md).

## Source split

- `motion.py` is standard-library-only and defines every sampled joint, foot contact, event,
  direction yaw, duration, and frame-sequence metadata value. The normal Python test suite covers
  it without installing or mocking `bpy`.
- `render_walk.py` is the only module that imports Blender APIs. It constructs owned geometry,
  applies each immutable pose directly, renders with headless Cycles CPU, validates RGBA and alpha
  bounds, compares direct left-facing views with mirrors, and transactionally publishes evidence.
- `scripts/package_blender_walk_demo.py` runs later in `animated-fabric-dev`. It validates the strict
  frame-sequence document and PNG set, then creates a contact sheet and synchronized GIF solely for
  human review. Those files are not the AF-051 product spritesheet.

## Run the complete experiment

All commands run from `apps/animated-fabric`. Docker performs productive work in Linux; no Python,
Blender, Pillow, or image dependency is installed on Windows.

```powershell
docker compose --profile blender config --quiet
docker compose --profile blender build animated-fabric-blender
docker compose --profile blender run --rm --no-deps animated-fabric-blender
docker compose run --rm --no-deps animated-fabric-dev `
  python scripts/package_blender_walk_demo.py `
  --source workspaces/blender/af044-demo `
  --out workspaces/blender/af044-demo/review
```

The default renderer writes exactly 49 source-evidence files (48 frames plus metadata), capped at
4 MiB, plus its adjacent provenance document:

```text
workspaces/blender/af044-demo/
├── provenance.json
├── walk/
│   ├── animation.json
│   ├── SE/000.png ... 011.png
│   ├── SW/000.png ... 011.png
│   ├── NE/000.png ... 011.png
│   └── NW/000.png ... 011.png
└── review/
    ├── walk_contact_sheet.png
    └── walk_review.gif
```

`workspaces/blender/` is deliberately untracked. The frame metadata uses the existing strict
`animated-fabric.frame-sequence.v1` contract so application-owned validation and future adapters
can inspect it mechanically. The adjacent `provenance.json` and experimental root are mandatory
context: metadata alone cannot distinguish these four direct views from authored/mirrored product
semantics. It is still experimental Blender evidence, not `ExportProject` output and not a product
export destination.

## Repeatability check

Render a second destination through the same fixed worker and compare every generated source frame
and deterministic document. Review media is packaged after that comparison.

```powershell
docker compose --profile blender run --rm --no-deps animated-fabric-blender `
  --out /output/af044-repeat
docker compose run --rm --no-deps animated-fabric-dev `
  sh -lc "diff -qr workspaces/blender/af044-demo/walk workspaces/blender/af044-repeat/walk && cmp workspaces/blender/af044-demo/provenance.json workspaces/blender/af044-repeat/provenance.json"
```

The worker canonicalizes each PNG after Blender writes it. Blender embeds the wall-clock date and
measured render duration in ancillary `tEXt` chunks; removing all ancillary chunks leaves the
encoded RGBA pixels intact and makes the complete evidence directory byte-repeatable.

The authoritative evidence run is native x86-64 Linux. A Docker Desktop result is a convenience
smoke check and must be identified as such. `provenance.json` intentionally contains no timestamp,
hostname, absolute host path, elapsed time, or container ID. Elapsed time is printed to the log and
recorded in `docs/STATUS.md` with the final go, revise, or stop conclusion. The separate
`animated-fabric-blender-evidence.yml` workflow repeats the build, isolation smoke, two timed
renders, strict hash verification, recursive comparison, packaging, and focused tests on native
Ubuntu x86-64 without changing the normal product quality gate.
