# Macaw traveler rig v1

This is the first complete Caatuu layered walker. It is the reference skin for
the reusable `caatuu-character-rig-v1` contract.

## Published assembly

- `head`, `torso`, and `tail` overlap on a 420 by 440 native canvas.
- The staff-side arm uses `arm-far-upper.png` plus the separate
  `hand-grip-spare.png`; the staff is a child of that grip joint and renders
  behind the hand.
- The free arm uses separate upper and lower/hand layers so its shoulder and
  elbow counter-swing are visible.
- Each leg layer contains its lower leg and foot. The movement host supplies
  their alternating stance and swing trajectories.
- Horizontal facing is produced by mirroring the assembled rig. There is only
  one authored side.

## Motion ownership

`rig.json` owns the character-specific walking and arrival channels: pelvis,
torso, head, tail, both arm chains, gripping hand, and staff. The generic
browser runtime evaluates these channel curves. The world movement demo owns
only speed, direction, world position, camera, and distance-driven feet.

At the default speed, one walking cycle covers 92 world pixels and lasts about
440 ms. Arrival lasts 360 ms: the last moving pose blends into a compressed
contact pose and then recovers to neutral. The same local pose is mirrored for
left-facing and right-facing arrivals.

## Source and QA

The 3 by 4 generated source sheet is preserved in `originals/`. Alpha removal,
sprite splitting, repacking, and previews were performed in the existing
Tukevejtso container using the workflow documented at
`C:\Work\tukevejtso\linux\scripts\images\SPRITE_SPLIT_REPACK.md`.

The isolated candidate contains exactly 12 non-empty sprites and zero split
warnings. `layers/` contains the validated runtime selections; candidate
splits, repacks, and previews remain separate so they can be audited without
being loaded by the game.
