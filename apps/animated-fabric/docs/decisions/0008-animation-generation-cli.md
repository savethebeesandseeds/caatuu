# 0008: Animation generation and CLI publication

- Status: accepted
- Date: 2026-07-18
- Ticket: AF-043

## Context

AF-041 and AF-042 provide deterministic idle and walk generators, but deliberately keep their
clips in memory. AF-043 must make those generators discoverable, expose their effective parameter
contracts, create normal editable animation documents, and register those documents in a project.

The specification fixes the `animation generate` command but does not define a discovery command,
schema wire format, `--set` grammar, custom clip presentation name, destination policy, diagnostic
codes, or a transaction spanning the clip and project manifest. It also requires structured JSON
diagnostics, which cannot itself carry a successful generator catalog.

## Decision

### Registry and discovery

`AnimationGeneratorRegistry` follows Appendix C: it lists summaries for a template and generates a
clip from a generator ID, rig, and raw parameter mapping. The built-in implementation eagerly owns
only `humanoid_idle_v1` and `humanoid_walk_v1`, sorts by generator ID, and performs no dynamic
imports, entry-point discovery, project-file loading, or arbitrary filesystem access.

Generator summaries are strict frozen domain values. Each parameter reports its stable ID, JSON
scalar type, default, hard minimum or maximum when present, and optional recommended bounds. The
registry normalizes this small contract from the strict Pydantic parameter models rather than
exposing raw, version-sensitive JSON Schema. Declaration order is preserved. Idle recommendations
remain guidance only; walk receives no invented recommendations or maxima.

The CLI surface is:

```text
animated-fabric animation list-generators --template TEMPLATE [--json]
animated-fabric animation generate ROOT --generator ID --clip ID \
  [--set NAME=JSON_SCALAR]... [--replace-existing] [--json]
```

Successful JSON discovery returns an array of generator-summary objects. Discovery failures retain
the normal six-field diagnostic array. Generate success continues to emit an empty diagnostic array
in JSON mode. Human output and help remain English.

Each `--set` value is split at its first `=` and decoded as one bounded JSON scalar. Names must be
canonical semantic IDs and may occur only once. Objects, arrays, non-finite constants, malformed or
oversized inputs, and duplicate names are rejected without echoing the submitted value. The selected
generator then performs strict type and range validation; the CLI does not coerce from schema data.

### Clip identity and validation

`--clip` is a semantic clip ID, never a filename or arbitrary path. A new clip uses the canonical
destination `animations/<clip_id>.animated-clip.json`; its display name is the deterministic English
title form of the underscore-separated ID. Existing default IDs therefore remain `Idle` and `Walk`.

`GenerateAnimation` loads the manifest and configured rig through ports, verifies project, rig, and
generator template compatibility, calls the registry, and rebuilds the generated data through
`AnimationClipBuilder` with the selected identity and effective destination. Tracks, events,
duration, loop behavior, FPS hint, and complete effective-parameter provenance remain generator
owned. The use case never prints, renders, exports, opens a window, or mutates its input rig.

Before publication, the use case loads the registered animation set, rejects ambiguous duplicate
paths or clip IDs, substitutes the candidate, and runs `ProjectValidator` over the resulting
manifest, rig, and clips. Errors block all writes; warnings may publish and remain visible. A unique
already-registered clip ID retains its registered safe path when explicitly replaced.

### Publication and replacement

Animation persistence has the same atomic create-or-replace primitive as rig persistence. New clips
always use no-replace publication, so a concurrent or unregistered existing destination is never
silently overwritten, even when `--replace-existing` was supplied. A registered destination requires
that explicit flag. Replacing it atomically changes only the clip and leaves manifest bytes intact.

For a new clip, publication proceeds in this order:

1. atomically create the clip without replacement;
2. append its path once to a detached manifest while preserving prior order; and
3. atomically replace the manifest.

If manifest publication fails after clip creation, the clip is deliberately left in place and the
diagnostic identifies it as unregistered. AF-043 does not attempt an automatic deletion: another
process may have registered the same unchanged clip after this process's manifest write failed, and
without a project lock or compare-and-swap manifest there is no safe way to distinguish that state.
Deleting by pathname could therefore turn another writer's valid manifest into a broken reference.
True cross-file atomicity, directory locking, multi-writer arbitration, and orphan recovery require
the AF-060 project-controller work and are not invented here.

Expected generator/request failures use `AFG001`, publication failures use `AFG002`, and missing
replacement confirmation uses `AFG003`. Structural builder and validator diagnostics keep their
existing `AFB` and `AFV` identities. CLI exits are 0 for success or warnings, 2 for structural or
replacement errors, 3 for expected request/project/repository failures, and 10 for a sanitized
unexpected boundary failure.

## Consequences

- Idle and walk now traverse one complete CLI-to-project pipeline and remain editable JSON clips.
- Generator discovery is deterministic and safe to expose without making built-ins a plugin system.
- Parameter parsing and errors are strict, bounded, and do not disclose rejected raw values.
- Replacement is deliberate and cannot claim an unrelated unregistered file.
- Per-file writes are atomic; a failed second write may leave a reported unregistered clip, while
  avoiding an unsafe rollback that could delete another writer's newly registered document.
- The remaining cross-file crash and concurrency window is explicit and deferred to the project
  lifecycle milestone.
- AF-043 does not add frame sampling, export files, presets, GUI controls, locks, or recovery state.
