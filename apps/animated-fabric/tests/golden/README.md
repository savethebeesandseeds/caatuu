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
- `af042_humanoid_walk_se_t0000.png`, `af042_humanoid_walk_se_t0200.png`,
  `af042_humanoid_walk_se_t0400.png`, `af042_humanoid_walk_ne_t0000.png`,
  `af042_humanoid_walk_ne_t0200.png`, and `af042_humanoid_walk_ne_t0400.png` lock the default
  `humanoid_walk_v1` contact, first lifted-foot, and opposite-contact phases on the fully applied
  owned rig.
- `af052_blender_walk_se_t0000.png`, `af052_blender_walk_sw_t0000.png`,
  `af052_blender_walk_ne_t0000.png`, and `af052_blender_walk_nw_t0000.png` lock one common phase of
  the fixed procedural 3D walk at four direct actor-root yaws. They are centered, fully bounded
  RGBA references and are materially distinct from horizontal mirrors. Their complete generation,
  hash, review, and public-domain records are in
  [`af052_blender_walk.provenance.json`](af052_blender_walk.provenance.json); only these four files
  are dedicated under [`CC0-1.0`](LICENSE-AF052-CC0.md).

To propose an AF-023 replacement, run `python scripts/run_demo_pipeline.py --out .tmp/demo`
inside the Linux development container, inspect both candidate frames, state the visual reason
for the change, and then update the reviewed files deliberately.

To generate AF-041 candidates, run
`python scripts/run_idle_animation_demo.py --out .tmp/af041-idle` inside the Linux development
container. The script writes all four quarter phases for both authored directions. Inspect all eight
frames, then copy only the four names listed above from `.tmp/af041-idle/frames/` after review;
tests never regenerate or replace reviewed goldens.

To generate AF-042 candidates, run
`python scripts/run_walk_animation_demo.py --out .tmp/af042-walk` inside the Linux development
container. The script writes all four quarter phases for both authored directions. Inspect all eight
frames, including the 600 ms opposite lifted-foot phase, then copy only the six names listed above
from `.tmp/af042-walk/frames/` after review; tests never regenerate or replace reviewed goldens.

To generate AF-052 candidates, first create a fresh current Blender evidence root, then run:

```bash
python scripts/generate_af052_directional_goldens.py \
  --source workspaces/blender/af052-demo \
  --out .tmp/af052-golden-candidates
```

Inspect all four candidates together before changing a reviewed file. Verification permits a
maximum decoded RGBA channel delta of 2 and at most 0.1% changed pixels per image; it also requires
both direct west views to differ from corresponding 2D mirrors by at least 10% at frame zero and
across the full walk. The generator refuses to replace existing goldens. Any deliberate update must
record a visual reason and refresh the provenance hashes.
