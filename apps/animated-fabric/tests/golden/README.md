# Reviewed renderer goldens

Golden files are committed only after visual inspection and are compared as decoded RGBA
pixels rather than encoded PNG bytes.

- `af022_compositor.png` locks the hand-authored 4 x 3 source-over compositor case.
- `af023_stick_humanoid_neutral_se.png` and
  `af023_stick_humanoid_neutral_ne.png` establish the initial complete-renderer baseline:
  a centered 192 x 192 geometric humanoid, transparent outside the actor, with authored
  direction-specific geometry, stable limb order, and no canvas-edge clipping.
- `af041_humanoid_idle_se_t0000.png`, `af041_humanoid_idle_se_t0500.png`,
  `af041_humanoid_idle_ne_t0000.png`, and `af041_humanoid_idle_ne_t0500.png` lock the default
  `humanoid_idle_v1` breath and quarter-phase counter-motion on the fully applied owned rig.

To propose an AF-023 replacement, run `python scripts/run_demo_pipeline.py --out .tmp/demo`
inside the Linux development container, inspect both candidate frames, state the visual reason
for the change, and then update the reviewed files deliberately.

To generate AF-041 candidates, run
`python scripts/run_idle_animation_demo.py --out .tmp/af041-idle` inside the Linux development
container. The script writes all four quarter phases for both authored directions. Inspect all eight
frames, then copy only the four names listed above from `.tmp/af041-idle/frames/` after review;
tests never regenerate or replace reviewed goldens.
