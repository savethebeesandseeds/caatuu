# Local workspaces

This directory is the host-visible exchange boundary for optional project tools.
Generated inputs and outputs are ignored by Git.

The cutout profiles mount:

- `cutout/input/` read-only at `/input`;
- `cutout/output/` read/write at `/output`; and
- the project-owned model volume read-only at `/models` during inference.

Create the local directories before the first run:

```bash
mkdir -p workspaces/cutout/input workspaces/cutout/output \
  workspaces/actor-packages workspaces/blender \
  workspaces/reconstruction/input workspaces/reconstruction/output
```

The optional `blender` Compose profile mounts `blender/` read/write at `/output`. Its fixed worker
writes only procedural direct-yaw evidence there and never reads project files or user art. The
normal development container validates that immutable evidence and publishes bounded product and
human-review directories as siblings.

The AF-053 Linux-host command owns three exact paths:

```text
workspaces/blender/af053-demo
workspaces/blender/af053-product
workspaces/blender/af053-demo-review
```

`af053-demo` is a closed evidence root containing only `walk/`, `directional-prerender.json`, and
`provenance.json` at top level. Product files belong only in `af053-product`; the contact sheet and
GIF belong only in `af053-demo-review`. An extra entry or symbolic link invalidates evidence. Run
`bash scripts/run_blender_directional_demo.sh` from a native non-root Linux host rather than
creating alternate productive roots by hand.

AF-055 owns a separate generated input and output pair:

```text
workspaces/actor-packages/geometric-fixture-v1/
|-- actor-package.json
|-- actor.glb
`-- textures/albedo.png

workspaces/blender/af055-neutral/
|-- neutral.png
`-- validation.json
```

Generate the package only with `scripts/generate_actor_package_fixture.py` in the development
container. The `blender-actor` profile mounts that exact package read-only at `/actor-package` and
mounts `workspaces/blender/` read/write at `/output`; the worker copies verified bounded bytes into
a private temporary snapshot before import. An extra, missing, linked, hard-linked, case-colliding,
renamed, or hash-mismatched input invalidates the package. An extra output invalidates the closed
neutral evidence tree. AF-055 does not accept a macaw or an arbitrary 3D file; AF-056 owns the first
reviewed actor package.

Native x86-64 Linux is authoritative for Blender evidence. Docker Desktop may exercise the same
Compose services as a convenience smoke, but its output does not replace the native acceptance
record.

AF-045 owns a separate, ignored reconstruction exchange:

```text
workspaces/reconstruction/
|-- input/                         # reviewed RGBA cutouts, mounted read-only
`-- output/
    `-- <candidate-id>/
        |-- candidate.json
        |-- input.png
        `-- mesh.glb
```

The `reconstruction-provision` profile writes pinned model files only to the
project-owned Docker volume. Offline inference mounts that volume read-only.
Candidate directories are immutable proposals and are not actor packages,
accepted geometry, or release artifacts.

Never place the model cache, credentials, or irreplaceable source artwork here.
