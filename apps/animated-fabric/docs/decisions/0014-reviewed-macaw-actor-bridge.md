# 0014: A reviewed macaw actor package bridges source art to directional prerender

- Status: accepted
- Date: 2026-07-21
- Tickets: AF-054 through AF-059
- Replaces: decision 0012's fixed-actor restriction and decision 0013's broader-actor deferral,
  only for the rights-cleared macaw vertical slice; the fixed AF-053 demo remains valid

## Context

AF-052 and AF-053 proved the second half of the intended production method: one immutable 3D walk
can be rendered at four actor-root yaws and packaged without rotating or mirroring finished pixels.
The proof deliberately used a rigid procedural humanoid. It did not define how approved character
art becomes a coherent, rigged 3D actor.

The repository already holds strong traveler-macaw identity evidence, a prepared side-view puppet
parts candidate, and a side-view walk reference. Their complete rights record is not yet present in
the root legal inventory, so they remain candidate evidence rather than cleared product assets.
They describe appearance and useful joint intent, but they do not determine hidden rear surfaces or
a complete three-dimensional body. Background removal can preserve a silhouette; it cannot recover
missing anatomy.

The user has selected the traveler macaw as the first real vertical slice and an anthropomorphic
traveler walk as its motion style. The bridge must therefore preserve artistic approval while
remaining deterministic, offline, data-only at its input boundary, and isolated from the normal
Python application.

## Decision

Animated Fabric adds a bounded reviewed-actor path in six tickets, AF-054 through AF-059. It is not
called image-to-3D and does not promise automatic reconstruction.

```text
immutable source art
        |
        v
reviewed front / left / back / right reference package
        |
        v
human-reviewed modeling and material authoring
        |
        v
validated data-only actor package
        |
        v
avian_v1 armature + reviewed skinning
        |
        v
one immutable avian_walk_v1 pose tuple
        |
        v
four direct actor-root yaw renders
        |
        v
existing verified grid packer + review media
```

An inferred turnaround is a proposal until a human records approval. A source image, transparent
cutout, generated view, or prepared 2D part is evidence only; none is silently promoted into
geometry, topology, material truth, or hidden anatomy.

## Reference package

AF-054 stages candidates under `.tmp/af054-review/`. After approval and rights clearance it owns a
tracked package under `assets/reference-packages/macaw-traveler-v1/` with:

- immutable source identities and SHA-256 values;
- four individual view files with hashes at a common canvas, scale, and ground line;
- ordered IDs `front`, `left`, `back`, and `right` under actor axes `+Y` forward, `+X` anatomical
  right, and `+Z` up: front camera at `+Y`, left camera at `-X`, back camera at `-Y`, and right
  camera at `+X`; the left proposal's beak points screen-left and the right proposal's screen-right;
- any combined review sheet with exact crop rectangles, treated as convenience rather than the
  per-view authority;
- generation or authorship provenance for every derived view;
- explicit status `candidate`, `approved`, or `rejected`;
- the recorded gait style `anthropomorphic_traveler`; and
- the proposed prop scope `staff_separate`, requiring approval because the initial actor and walk
  omit the staff while preserving a hand socket for later equipment work; and
- a separate approval record containing the exact manifest SHA-256, ordered view-set digest,
  decision, UTC date, and reviewer role before AF-056 may consume it.

The optional cutout plane may provide a reviewed transparent derivative. It remains independent of
prepared transparent input and MUST NOT be described as semantic separation or hidden-surface
reconstruction. Original files are never overwritten.

## Actor-package boundary

AF-055 defines `animated-fabric.actor-package.v1` and proves it with a repository-generated
geometric fixture, not the macaw. A package is data-only and may contain a bounded GLB plus
explicitly listed textures and one JSON manifest. The validator MUST enforce exact regular files
and hashes, canonical units and axes, one actor root, finite geometry, resource limits, contained
texture references, and a neutral render. It MUST reject:

- `.blend` files, Python, drivers, expressions, add-ons, and executable hooks;
- symbolic links, hard links, reparse points, traversal segments, absolute paths, unsupported URI
  schemes, external references, and undeclared files;
- embedded animation, cameras, lights, audio, and scene-level behavior;
- unsupported extensions or compression; and
- meshes, materials, textures, joints, or image dimensions above recorded limits.

The package is mounted read-only into the isolated Blender worker. Product Python never imports
`bpy`, invokes Docker, or executes package-provided code. General untrusted 3D import remains out of
scope.

## Avian rig and motion

AF-056 defines the stable `avian_v1` hierarchy. A human-reviewed modeling step authors the neutral
macaw mesh and materials from the approved references, then creates its armature and skin weights
as the first rights-cleared macaw actor package. Vertex skinning is permitted only inside this
isolated 3D prerender plane. Weights must be finite and normalized, influences bounded, joints
mapped explicitly, and bind/deformation poses reviewed. This exception does not add mesh
deformation to the layered-2D renderer or GUI.

AF-057 defines `avian_walk_v1` as one deterministic in-place anthropomorphic traveler gait. It
must close exactly, alternate foot contacts, bound stance-foot drift, clear the swing foot, avoid
ground penetration, shift body weight, stabilize the head, and apply controlled secondary motion
to wings and tail. The motion must work on both a geometric avian fixture and the approved macaw.

AF-058 extends the direct-yaw worker to the validated actor package. It computes one immutable
motion tuple and fingerprint, then rerenders it at `SE=-90`, `SW=180`, `NE=0`, and `NW=90` with the
same camera, timing, materials, and lighting. The AF-051 verified grid packer remains unchanged.

AF-059 provides one native-Linux end-to-end command and review artifact. Acceptance requires two
clean repeated runs, no clipping, no visible skin collapse, no unacceptable foot sliding, and
explicit visual approval.

## Decisions preserved

- ADR-001 remains normative: missing 2D surfaces cannot be recovered reliably.
- ADR-002 remains normative: directions are direct 3D yaw renders, never transformed final pixels.
- ADR-004 remains normative: Blender is the pixel authority for this source path.
- ADR-009 remains normative: background removal is optional, self-contained, offline at runtime,
  and produces reviewed derivatives.
- ADR-010 remains normative: productive execution and acceptance happen in Linux containers.
- AF-053 remains a frozen fixed-humanoid proof and its accepted outputs are not rewritten.
- The normal package, layered renderer, project schemas, CLI, and GUI gain no Blender dependency.

## Security, provenance, and publication

The Blender image remains internal-only until its recorded redistribution gates are satisfied.
AF-055 must update the Blender third-party record for the new read-only data boundary. Every source,
turnaround, texture, mesh, motion, render, and public sample requires an explicit provenance and
license entry before publication. Candidate art and raw workspaces are not public CI artifacts.
The root Caatuu legal inventory and this application inventory must both contain the corresponding
evidence before source art or derivatives are tracked as accepted or published.

Where Caatuu controls the necessary rights, the intended default is `CC0-1.0` for the accepted
macaw reference art, actor art package, and named public demo pixels so others may inspect and reuse
them freely. Source code, schemas, manifests, and reports remain under their recorded repository
terms; third-party material keeps its own terms. The legal inventory names exact files before any
dedication or publication takes effect.

Runtime networking is prohibited. Model or image generation, if used to propose reference views,
is an authoring-time activity outside the product runtime and is recorded as such. No generated
proposal becomes approved merely because it is visually plausible.

## Consequences

- The proven yaw-render and export conveyor remains intact while a new real-character demo succeeds
  the crude mannequin proof through explicit review gates; the AF-053 implementation is unchanged.
- Motion reuse is promised only within the compatible `avian_v1` family, not across arbitrary
  skeletons.
- GLB parsing and skinning add risk, so the first inputs remain rights-cleared, bounded, hashed,
  read-only, and sandboxed.
- AF-060 is deferred, not cancelled. It becomes the next permitted ticket after AF-059.
- This decision authorizes AF-054 only; later tickets still require their own bounded delivery.
