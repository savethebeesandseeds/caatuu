# Caatuu layered character rigs

This folder defines the reusable asset contract for characters that walk in the
painted world. A rig separates **motion** from **character artwork**: the same
locomotion clip can drive a macaw, robot, or later character as long as its
skin supplies the expected bones, layers, pivots, and contact points.

## Coordinate contract

- Every rig declares one native composition canvas and one bottom-centre
  character origin. Individual PNG layers may be tightly cropped; their
  `size`, image-space `pivot`, bone pivot, and rest scale place them back into
  the shared composition space.
- Runtime display scale is applied only after the complete character has been
  composed, so bone motion is independent of the size used in the world.
- A pivot is the joint around which a layer rotates. Artwork must extend a few
  pixels behind its parent layer at each joint so rotations never reveal gaps.
- Left/right movement mirrors the assembled rig. Do not generate a second set
  of horizontally flipped art.
- Feet and optional staff tips expose ground-contact points. The movement host
  combines those contacts with its distance-driven stance trajectory.

## Standard bone names

The portable skeleton is:

```text
root
  pelvis
    torso
      head
      tail
      arm_far_upper -> arm_far_lower -> hand_far
      arm_near_upper -> arm_near_lower -> hand_near
    leg_far_upper -> leg_far_lower -> foot_far
    leg_near_upper -> leg_near_lower -> foot_near
      prop_primary (parented to the gripping hand or lower arm)
```

A short-limbed character may omit or combine adjacent bones. For
example, the macaw can use one `leg_near_lower` image containing both shin and
foot. Missing optional bones inherit their parent transform.

## Required locomotion states

1. `standing`: balanced silhouette, hands and feet settled.
2. `starting`: weight shifts onto the first support foot.
3. `walking`: looping, distance-driven gait with alternating support contacts.
4. `arriving`: the final swing foot lands and all upper-body motion decays.

The walk clip must animate more than the feet: pelvis travel, torso and head
counter-rotation, arm swing, elbows/hands, tail follow-through, and any held
prop. A staff should remain visually attached to its gripping hand and settle
with the body in the arrival clip.

## Clip channels

Clip channels live in each character's `rig.json`, not in the world demo. A
channel key uses `bone.property`, for example `arm_near_lower.rotation` or
`pelvis.y`. Values are native-canvas pixels or degrees, and keyframe `at`
positions are normalized from 0 to 1. The shared runtime interpolates
`linear`, `smooth`, `ease-in`, and `ease-out` channels.

The movement host remains responsible only for world translation and the two
distance-driven foot trajectories. This lets another character reuse the same
host while supplying different proportions, pivots, arm motion, secondary
motion, prop behavior, and landing response in its manifest.

## Asset pipeline

1. Keep generated source sheets under the character's `originals/` folder.
2. Split sheets with the documented Tukevejtso workflow in
   `C:\Work\tukevejtso\linux\scripts\images\SPRITE_SPLIT_REPACK.md`.
3. Validate count, empty warnings, layer isolation, alpha edges, pivots, and a
   neutral reconstruction preview.
4. Publish only validated layers and the final `rig.json` manifest.

`rig.schema.json` is the machine-readable manifest contract. Character folders
may also contain a `rig-plan.json` while their art is still being prepared.
