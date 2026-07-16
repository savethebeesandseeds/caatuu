# Caatuu demos

Large, isolated development experiments live here instead of inside a
production app's `static/assets` catalog. The Caatuu runtime serves this folder
at `/demos/`.

## Available projects

- `world-movement/` - character locomotion, pose-authority, sprite-generation,
  and browser-animation laboratory.

Each project should keep its runtime files, research material, documentation,
and preserved generated sources together. Shared production assets may be
referenced from `/assets/`, but should not be copied into a demo.
