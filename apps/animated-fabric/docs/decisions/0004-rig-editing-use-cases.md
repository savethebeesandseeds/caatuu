# 0004: Rig-editing use-case boundaries

- Status: accepted
- Date: 2026-07-17
- Ticket: AF-033

## Context

AF-033 requires application use cases that move a bone, move a pivot, assign a part, and change a
draw slot. The specification names the shared `UpdateRigElement` boundary but does not define
request shapes, CLI syntax, edit diagnostics, or whether an edit targets base rig values or an
authored-direction profile.

The rig produced by AF-032 contains complete `SE` and `NE` direction profiles. Pose resolution
prefers those profile overrides, so changing only a base bone transform or pivot would persist an
apparently successful edit that does not affect rendering. The v1 schema also keeps
`PartBinding.draw_slot` and `PartBinding.bone_id` direction-invariant. It has no persisted project
revision or undo history.

## Decision

The application exposes one `UpdateRigElement` use case with four frozen typed update values:

- `MoveBone` replaces one bone's parent-local position for one authored direction;
- `MovePivot` replaces one part's trimmed-image pivot for one authored direction;
- `AssignPart` rebinds one existing part to one existing bone; and
- `ChangeDrawSlot` changes one existing part's direction-invariant draw slot.

`AssignPart` does not create or remove `PartBinding` records, alter the layer catalog, or repeat
semantic import mapping. Rebinding changes only `bone_id`; it does not attempt to preserve the
part's prior world pose automatically. Such compensation would require an explicit affine-editing
contract and remains a visual adjustment through the bone and pivot operations.

Bone and pivot updates require a direction declared as authored by the project and an existing
direction profile. They create or replace only the selected profile override. A bone move preserves
the effective rotation and scale, its parent, length hint, lock state, base transform, and every
other direction. Locked bones reject value-changing moves, while identical requests remain
successful no-ops. A pivot move requires an effective asset selection for that part and direction.
Effective profile pivots are validated against the effective profile asset, rather than only against
the base binding values.

Draw-slot changes do not alter `draw_slot_profiles`, direction-profile `slot_order`, or the part's
stable `slot_order`. The requested slot must already exist in the rig's draw-slot inventory, and
the complete candidate must remain resolvable for every visible authored direction. Per-direction
slot assignment still requires a future schema and migration.

The use case loads the manifest, configured rig, and layer catalog through application ports. It
constructs detached typed models, validates the complete candidate, and performs exactly one atomic
rig replacement only when the candidate changed and contains no error diagnostics. Warning-only
candidates may publish. An exact-value update is a successful no-op and performs no write.

AF-033 owns `AFU001` for repository or persistence boundary failures, `AFU002` for a missing or
ambiguous edit target, and `AFU003` for an edit rejected by its contract. Candidate structural
problems retain the existing `AFV` codes, including `AFV206` for an extreme effective pivot and
`AFV401` for an unknown draw slot.

A successful result reports `project_revision_delta` as `1` for a persisted mutation and `0` for a
no-op. This is a caller-owned transient signal; it does not add a field to project JSON. The future
document controller increments `RenderProject.project_revision` and can then eagerly invalidate
bounded renderer caches. Rig fingerprints already prevent a changed rig from receiving a stale
cached computation.

AF-033 does not introduce CLI edit syntax, GUI state, `QUndoStack`, autosave, locking, or persisted
undo history. The functional GUI and reversible command wrappers remain AF-060 through AF-062. The
existing repository replacement is atomic per file, but concurrent read-modify-write operations
remain last-writer-wins until the project-locking milestone.

## Consequences

- All four AF-033 operations are reachable through one Qt-independent application boundary.
- Direction-specific edits affect the renderer while preserving the template-created base rig and
  the unselected authored direction.
- Full candidate validation prevents a partial or structurally invalid rig from being published;
  warnings remain actionable without blocking deliberate edits.
- Source PNGs, the project manifest, layer catalog, animations, sockets, and non-target rig values
  remain unchanged.
- Later GUI commands can retain old/new rig values and use the revision delta without migrating the
  v1 rig schema.
- Multi-writer arbitration, directory durability beyond the existing atomic-file contract, GUI
  undo, and automatic pose compensation remain explicit future work.
