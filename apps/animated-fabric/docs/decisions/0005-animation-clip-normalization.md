# 0005: Animation clip normalization

- Status: accepted
- Date: 2026-07-18
- Ticket: AF-040

## Context

AF-040 requires a safe clip builder, normalized keyframes, and event handling before the humanoid
generators are introduced. The persisted `AnimationClip` models, AF-021 interpolation and evaluator,
rig-aware animation validator, and atomic animation repository already exist. Reimplementing any of
those contracts in a builder would create competing evaluation or validation behavior.

The specification also leaves a loop-boundary ambiguity. General track evaluation holds the last
key when no later key exists, while the generator design authors phases at `0`, `1/4`, `1/2`, and
`3/4` with the loop endpoint implicit. Holding the `3/4` value until wrap would flatten the final
quarter of a smooth periodic curve. Changing AF-021 evaluation globally would alter existing valid
clips, including clips with a deliberate explicit endpoint.

Animation persistence introduces a separate boundary. Publishing a new clip requires both an
animation document and an updated `ProjectManifest.animation_paths`, but the current repository
offers atomicity only per file and replaces animation files without a create-versus-replace policy.

## Decision

AF-040 adds a pure, Qt-independent application builder. It accepts typed clip construction input and
a rig, performs no IO, and returns `OperationResult[AnimationClip]`. The builder reuses the existing
AF-021 interpolation and animation-validation behavior; it does not add a second evaluator or a
parallel set of channel rules.

The builder owns the fixed v1 artifact identity. It writes
`format="animated-fabric.animation-clip.v1"` and `schema_version="0.1.0"`, and takes `template_id`
from the supplied rig rather than accepting a competing caller value. It constructs a detached
result, including a detached recursive copy of generator provenance parameters.

Normalization follows these rules:

- track declaration order is preserved;
- each track's keys are stable-sorted by `time_ms` without changing values or interpolation modes;
- duplicate times, out-of-duration keys, invalid values, and invalid channels are never dropped,
  clamped, deduplicated, or otherwise silently repaired;
- for a looping track with keys but no key at `duration_ms`, the builder appends one endpoint whose
  value equals the effective first value, allowing the existing evaluator to interpolate the final
  loop quarter;
- an explicit key at `duration_ms` is preserved exactly, even when its value differs from the first
  key, because changing it would rewrite authored animation;
- events are stable-sorted by `time_ms`; ties retain declaration order and duplicate events remain
  distinct; and
- an event authored at `duration_ms` is not rewritten to time zero for a loop. Event dispatch keeps
  the existing exact-normalized-sample behavior, and interval-crossing dispatch remains future work.

Existing `AFV301` through `AFV307` diagnostics remain authoritative for missing targets, key range
and ordering problems, duplicate keys, empty clips, event range warnings, and invalid channels or
values. Warning-only candidates may be returned. `AFB001` is reserved only for a clip that cannot be
constructed as the typed v1 artifact; it does not replace a more specific `AFV` diagnostic.

AF-040 does not save a clip, update the project manifest, define `GenerateAnimation`, expose CLI or
GUI controls, or introduce humanoid generator formulas. Persistence and explicit create/replace
semantics remain AF-043. The idle and walk formulas remain AF-041 and AF-042 respectively.

## Consequences

- AF-041 and AF-042 can produce ordinary editable clips through one deterministic builder without
  depending on persistence or presentation code.
- Existing evaluators, renderers, validators, and persisted clips retain their AF-021 behavior.
- Generated looping curves receive a closing segment without globally changing last-key hold
  semantics or overwriting explicit endpoints.
- Input tracks, keys, events, provenance, and the rig remain unchanged by construction.
- Invalid authored data remains visible through stable diagnostics instead of being silently
  normalized into different animation.
- Multi-file publication, rollback, manifest registration, overwrite confirmation, CLI syntax, and
  GUI state remain explicit later decisions rather than hidden builder behavior.
