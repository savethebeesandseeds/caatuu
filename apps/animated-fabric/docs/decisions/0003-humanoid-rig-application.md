# 0003: Humanoid rig-application defaults

- Status: accepted
- Date: 2026-07-17
- Ticket: AF-032

## Context

The specification requires template application to create proportional bones, map semantic assets,
estimate pivots, create bindings and sockets, build SE and NE profiles, diagnose missing elements,
and protect an existing rig from implicit replacement. It does not provide a complete 17-bone
layout, most socket offsets, or full direction-specific slot arrays. Decision 0002 deliberately left
those application policies to AF-032.

`PartBinding.draw_slot` is direction-invariant in the v1 rig schema. A direction profile can reorder
slots and override asset selection, pivots, visibility, and bone rest transforms, but it cannot move
one binding to a different slot. AF-032 therefore needs a deterministic convention that works
without changing the persisted schema.

## Decision

The application owns one reviewed humanoid reference layout on a 192 x 192 canvas with root at
`[96, 160]`. For a project canvas, reference offsets from that root are scaled independently by
`canvas_width / 192` and `canvas_height / 192`, then translated to the project's declared ground
anchor. Bone rest transforms are derived from those scaled world joints relative to each parent;
rotations remain zero and scales remain one. This preserves the project anchor while supporting
non-square canvases without embedding executable geometry in the template resource.

The reference world joints are:

| Bone | SE | NE |
|---|---:|---:|
| `root` | `[96, 160]` | `[96, 160]` |
| `pelvis` | `[96, 108]` | `[96, 108]` |
| `torso` | `[96, 94]` | `[96, 94]` |
| `neck` | `[96, 64]` | `[96, 63]` |
| `head` | `[96, 61]` | `[96, 60]` |
| `upper_arm_l` | `[84, 70]` | `[85, 68]` |
| `lower_arm_l` | `[70, 92]` | `[72, 89]` |
| `hand_l` | `[61, 115]` | `[61, 112]` |
| `upper_arm_r` | `[108, 69]` | `[108, 68]` |
| `lower_arm_r` | `[122, 92]` | `[122, 90]` |
| `hand_r` | `[132, 115]` | `[132, 112]` |
| `thigh_l` | `[88, 106]` | `[87, 105]` |
| `shin_l` | `[82, 130]` | `[81, 130]` |
| `foot_l` | `[78, 153]` | `[77, 153]` |
| `thigh_r` | `[102, 105]` | `[101, 105]` |
| `shin_r` | `[112, 130]` | `[111, 131]` |
| `foot_r` | `[120, 153]` | `[119, 153]` |

Each binding selects imported assets by exact semantic part and authored direction. Its neutral
pivot is reconstructed in trimmed-image coordinates as the scaled bone joint in canvas space minus
the asset's `trim_origin`. With an identity bind transform, this places a trimmed layer at the same
canvas position at which it was authored. The application also owns reviewed reference offsets for
the eight `humanoid_v1` sockets and scales those offsets by the same per-axis factors. Socket IDs,
parent bones, and default slots continue to come from the validated template resource.

The socket offsets are `head_hat [0, -22]`, `head_face [8, -8]`, `back_cape [0, -22]`,
and `[0, 0]` for `hand_l_item`, `hand_r_weapon`, `hand_l_shield`, `waist_item`, and
`root_shadow`.

Anatomical left limb bindings use the fixed far arm or leg slots and anatomical right limb bindings
use the corresponding near slots; torso, head, optional hair, cape, pelvis, neck, and shadow parts
use their named semantic slots. Complete SE and NE slot arrays reorder those fixed slots to provide
direction-aware draw profiles. This is the v1 compromise required by direction-invariant
`PartBinding.draw_slot`; changing a part's slot per direction would require a future schema and
migration rather than an implicit AF-032 extension.

The complete profiles are ordered as follows:

```text
SE: ground_shadow, cape_back, weapon_back, leg_far, arm_far, leg_near,
    body_back, torso, head_back, arm_near, head, hair_front,
    shield_front, weapon_front, fx_front
NE: ground_shadow, cape_back, weapon_back, leg_near, arm_near, leg_far,
    body_back, torso, head_back, arm_far, head, hair_front,
    shield_front, weapon_front, fx_front
```

Every required template part must have an imported asset for every authored project direction before
the rig is saved. A missing required part or direction is an error. An entirely absent optional part
creates no empty binding; a one-view optional binding is hidden in the missing direction and emits a
warning. Extra unmapped catalog parts are not assigned to guessed bones and remain visible through
the existing validator warning. Diagnostics are stable and no partial rig is published on error.

After a rig exists, authored-direction coverage is validated from each binding's selected asset and
directional visibility, rather than by treating raw catalog labels as a second anatomy. This lets a
persisted mixed-alias binding and a hidden one-view optional binding revalidate consistently, while
unbound artwork remains an `AFV204` warning.

AF-032 owns codes `AFT001` for repository/resource boundary failures, `AFT002` for missing required
art, `AFT003` for replacement confirmation, `AFT004` for an optional missing direction, `AFT005`
for ambiguous canonical/alias mappings, and `AFT006` for project/template constraint failures.
Unmapped catalog assets continue to use the validator's existing `AFV204` warning.

`ApplyRigTemplate` refuses to replace any existing rig unless its typed request carries explicit
replacement confirmation. The CLI spells that confirmation `--replace-existing`. A confirmed
application constructs and validates the complete rig before one atomic repository save. The
project manifest, imported layer files, and layer catalog remain unchanged.

For an unconfirmed first application, the repository publishes the fully flushed temporary JSON
through an atomic same-directory hard link that fails if the destination already exists. This keeps
the non-overwrite guarantee at the write boundary instead of relying on a racy read-before-write
check or parsing an arbitrary existing rig merely to establish its presence.

## Consequences

- Applying `humanoid_v1` is deterministic for the same project manifest and layer catalog.
- Trimmed imports preserve their authored neutral placement while gaining bone-relative pivots.
- Sockets and complete SE/NE profiles are immediately available to later editing and animation work.
- One-view optional and unknown artwork remains visible to callers as diagnostics rather than being
  silently discarded or guessed into the rig.
- AF-032 does not add rig editing, undo, GUI workflows, animation generators, complete-frame
  mirroring, a public general-project render command, export, equipment behavior, or `quadruped_v1`.
