# 0012: One canonical 3D motion drives four yaw-rendered directions

- Status: accepted; clarified in part by decision 0013
- Date: 2026-07-21
- Ticket: AF-052
- Replaces: the 3D-output portions of SPEC ADR-001, SPEC ADR-002, and SPEC ADR-004;
  decision 0010's product-promotion prohibition; and the AF-052 mirroring clauses of decisions
  0009 and 0011

Decision 0013 implements the deferred Linux-host one-command orchestration. It also replaces only
this decision's internal-use restriction for the official `walk.png`, `walk_contact_sheet.png`, and
`walk_review.gif` CI outputs, which now have a scoped `CC0-1.0` dedication. JSON, source, raw
evidence frames, and the Blender container retain their existing terms and distribution gates; all
other security, rendering, and source-path boundaries below remain normative.

## Context

The original MVP assumed two layered 2D views and two complete-frame horizontal mirrors. AF-044
then proved a different bounded source path: one repository-owned procedural 3D actor, one
deterministic in-place walk, one fixed orthographic camera, and four direct views produced by
rotating only the actor root around its vertical axis. The direct `SW` and `NW` frames preserve
anatomy and directional lighting better than horizontal mirrors of finished `SE` and `NE` pixels.

The user has selected that yaw-rendered approach for the 3D path. Direction must therefore be a
view of one shared motion, not a separately generated animation. Productizing the AF-044 result
requires an explicit replacement decision because decision 0010 deliberately kept the experiment
outside product export, while the normative specification assigned AF-052 to 2D mirroring.

## Decision

### Two bounded source paths

The existing layered-2D/OpenCV workflow remains supported and unchanged. Layered PNGs are still its
stable input boundary, and preview and export continue to share `OpenCvRenderer`. AF-052 does not
pretend that those 2D projects contain 3D geometry, weaken their validation, or mark `SW` and `NW`
as authored layers.

The owned Blender actor gains a second, explicitly bounded 3D-to-2D prerender path. For this path,
Blender is the rendering authority that creates the RGBA frame sequence. Human review and product
grid export both consume that same verified sequence; neither reimplements the scene or animation.
This is the narrow exception to the former single-renderer wording in SPEC ADR-004. It does not
authorize arbitrary renderers or user-provided Blender execution.

Layered input is no longer the only permitted source of product pixels, but SPEC ADR-001 remains
normative for every layered-2D project and for optional background removal. No composite image is
treated as recoverable hidden art.

### One motion, four actor-root yaws

The worker constructs one immutable twelve-frame, one-second walk tuple exactly once per render
transaction. That tuple is the canonical 3D motion for this bounded actor. Every direction reuses
the same pose objects, frame indexes, times, integer durations, and semantic events.

The camera, lighting, materials, geometry, and motion remain fixed. Only the actor-root yaw changes:

| Direction | Actor-root yaw |
|---|---:|
| `SE` | -90 degrees |
| `SW` | 180 degrees |
| `NE` | 0 degrees |
| `NW` | 90 degrees |

The worker renders each view again from the 3D scene. It MUST NOT rotate, mirror, warp, or otherwise
transform a finished 2D frame to fabricate another direction. Mirror operations remain permitted
only as independent comparison measurements proving that the direct views are materially distinct.

### Directional-prerender artifact

The Blender transaction writes a strict adjacent
`animated-fabric.directional-prerender.v1` document with schema version `0.1.0`. It identifies the
fixed project/actor source, animation, canonical frame-sequence path, `actor_root_yaw` strategy,
ordered direction/yaw pairs, and one SHA-256 fingerprint of the shared motion tuple. The document is covered by the
existing source-evidence hashes and is required before any frame may enter product packaging.

The AF-050-compatible `walk/animation.json` remains the frame authority for size, origin, FPS,
duration, row order, frame paths, exact duration distribution, and events. The directional
document and frame metadata must agree exactly. This ticket supports only the owned
`blender_humanoid` actor, `walk`, `SE`/`SW`/`NE`/`NW`, 192 x 192 RGBA frames, twelve samples, and
the fixed yaw table above.

### Product grid packaging

AF-051's frame-sequence-to-grid implementation becomes a reusable verified packer. It validates
the exact source file set, parses the strict frame metadata, decodes every RGBA PNG, enforces the
existing dimension and raw-byte limits, copies every source pixel into its canonical cell, writes
strict `animated-fabric.grid-spritesheet.v1` metadata, reopens both artifacts, and verifies every
cell byte for byte.

The AF-052 packager first verifies the complete directional-prerender evidence and then invokes that
same packer. It publishes exactly `walk.png` and `walk.spritesheet.json` as one backup-based atomic
directory transaction. The sheet is 2,304 x 768 pixels, with direction-major rows in
`SE`, `SW`, `NE`, `NW` order and twelve time-major columns. Packaging never calls Blender and never
modifies source evidence.

This two-stage boundary is deliberate. The Blender container renders; the normal development
container validates and packs. Product Python does not invoke Docker, mount the Docker socket, or
import `bpy`. Decision 0013 later adds Linux-host orchestration around the already approved stages
without changing that boundary.

### Compatibility and migration

No persisted project, rig, animation, frame-sequence, or grid schema changes in AF-052. Existing
layered projects require no migration and retain their authored/mirrored declarations. The
project-based `animated-fabric export --profile default_grid` does not silently switch renderers;
for now it still requires explicit authored direction overrides. The bounded prerender packager
selects `walk` explicitly because the 3D source has no `idle` clip. A later product-input ticket
must define general 3D actors before the normal project command can claim that behavior.

### Isolation, security, licensing, and support

The promoted path retains AF-044's pinned Linux/amd64 Blender version, checksum-verified archive,
factory startup, disabled auto-execution, offline runtime, non-root identity, read-only filesystem,
bounded output mount, CPU/memory/process/time limits, and prohibition on user `.blend` files,
scripts, add-ons, models, textures, fonts, HDRIs, and external motion.

The container remains internal-only while the Blender notice inventory, corresponding-source
offer, SBOM, Debian snapshot policy, and redistribution review are unresolved. At AF-052 acceptance,
generated PNG output was limited to internal review and consumption. Decision 0013 later permits
only three named official CI media files under its scoped CC0 dedication; it does not claim that the
container image is ready for public distribution. General user models, arbitrary scenes, armature
or skinning import, editor support, and cross-platform Blender support remain out of scope.

### Verification and goldens

Acceptance requires:

1. one precomputed motion tuple and one stable motion fingerprint reused by all four yaw passes;
2. 48 direct, bounded, transparent RGBA frames with identical schedules and events per direction;
3. independent proof that direct `SW`/`NW` differ materially from mirrored `SE`/`NE`;
4. reviewed committed frame-zero goldens for all four directions with explicit decoded-pixel
   tolerance, dimensions, alpha bounds, and visual rationale;
5. a verified four-row product sheet whose cells equal the source frames byte for byte;
6. safe rejection of missing, extra, linked, tampered, malformed, or oversized source/output data;
7. two clean native-Linux renders with deterministic comparison in the pinned environment; and
8. the unchanged normal Linux quality gate without Blender in the base runtime.

The Blender provenance metric and the independent PNG verifier use different decoded color
representations and are not expected to be numerically identical. Both must independently exceed
the same 10% different-pixel floor; the verifier also enforces that threshold at frame zero.

## Consequences

- All four views share one movement; direction changes only actor-root yaw.
- Direct `SW` and `NW` replace complete-frame mirroring for the bounded 3D actor.
- The existing 2D project format and renderer remain usable without a migration or Blender.
- AF-052 yields a real four-direction walk spritesheet but not a general 3D project importer.
- A new idle motion, arbitrary actor input, sockets/hitboxes projected from 3D, and public Blender
  image distribution remain later work. Decision 0013 separately supplies the bounded host command
  and the narrow generated-media publication rule.
- AF-053 was the next permitted ticket after this decision; decision 0013 governs it.
