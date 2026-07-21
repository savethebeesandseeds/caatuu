# Local workspaces

This directory is the host-visible exchange boundary for optional project tools.
Generated inputs and outputs are ignored by Git.

The cutout profiles mount:

- `cutout/input/` read-only at `/input`;
- `cutout/output/` read/write at `/output`; and
- the project-owned model volume read-only at `/models` during inference.

Create the local directories before the first run:

```bash
mkdir -p workspaces/cutout/input workspaces/cutout/output workspaces/blender
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

Never place the model cache, credentials, or irreplaceable source artwork here.
