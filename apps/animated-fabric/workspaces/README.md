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

The optional `blender` Compose profile mounts `blender/` read/write at `/output`. Its fixed AF-044
worker produces only procedural, reproducible feasibility evidence there; it does not read project
files or user artwork and it is not a product export destination.

Never place the model cache, credentials, or irreplaceable source artwork here.
