# 0011: Authored-direction grid spritesheet export

- Status: accepted
- Date: 2026-07-21
- Ticket: AF-051
- Replaces: the post-publication backup-cleanup clause of decision 0009

## Context

AF-051 owns direction rows, frame columns, exact duration, the public profile-based export command,
and `animated-fabric.grid-spritesheet.v1` JSON. AF-052 separately owns complete-frame `SW`/`NW`
mirroring and mirrored spatial metadata. The normative `default_grid` profile already names all four
directions, so silently omitting mirrored rows or implementing mirroring here would make either the
profile or the ticket boundary untrue.

Section 18.3's illustrative metadata omits `schema_version`, while the global data rule requires it
on every persisted file. AF-050 also established a verified directory transaction, but decision
0009 said a backup-cleanup failure should attempt rollback. Once recursive backup deletion has
started, that backup may be incomplete and is no longer safe restoration material.

## Decision

### Profile and AF-052 boundary

`default_grid` is one fixed package-owned profile. It uses the normative `idle`, `walk`,
`SE`/`SW`/`NE`/`NW`, 12 FPS, fixed cells, JSON, no timestamp, and no trimming defaults. A project
must register the profile ID before it can be selected; project files never supply executable or
dynamically discovered profile code.

The public command is:

```text
animated-fabric export ROOT --profile PROFILE --out DESTINATION
  [--animation ID]... [--direction DIRECTION]... [--fps FPS]
  [--allow-clipping] [--json]
```

Explicit repeated animation and direction overrides preserve caller order. AF-051 succeeds only for
authored directions, such as `--direction SE --direction NE`. Selecting the unmodified four-row
default against the normative mirrored project reports actionable `AFV502` and names AF-052. It
does not drop rows, duplicate source rows, mirror pixels, or invent mirrored metadata.

### Artifact contract

Each selected animation publishes exactly two flat files:

```text
<destination>/<animation>.png
<destination>/<animation>.spritesheet.json
```

The PNG is transparent RGBA with fixed project-canvas cells. Rows follow the selected direction
order and columns follow increasing frame index. Metadata is strict
`animated-fabric.grid-spritesheet.v1` with `schema_version` `0.1.0`, the project slug, animation,
canonical image path, frame size, ground-anchor origin, FPS, clip duration, direction order, frame
count, canonical rectangles, exact integer frame durations, and events. Each row's durations sum
exactly to the clip duration.

JSON is UTF-8, sorted where ordering has no meaning, indented by two spaces, and ends in one newline.
PNG encoding has no timestamps or ancillary metadata. Repeated equivalent exports are byte
identical on the same supported environment.

### Shared renderer and verification

`GridSpritesheetExporter` composes `FrameSequenceExporter` as the rendering authority. It therefore
uses AF-050 sampling, event binning, clipping policy, frame verification, and the same application
renderer as preview. The intermediate sequence remains private to the outer stage.

Before packing, the grid adapter compares the complete intermediate result and metadata against the
authoritative request: transaction destination, result type and paths, project, format and schema,
canvas and origin, FPS, clip duration, direction order, frame count, every duration, every event,
and every canonical frame path. Each source must be an exact-size RGBA PNG. After writing a sheet,
the adapter decodes it and compares every cell byte for byte with its source frame. Metadata is
written last and parsed back through the strict model. Intermediate removal is verified before the
outer file set may be published.

One sheet dimension may not exceed 65,535 pixels, and existing 4,096-frame and 512 MiB raw-RGBA
request limits still apply. Cancellation is checked before I/O, while packing and verifying cells,
at metadata boundaries, and before publication.

### Transaction cleanup replacement

Both exporters use the shared same-filesystem sibling stage and backup swap. Cleanup of an owned
stage is unconditional, including when an unexpected exception escapes. Before the verified stage
becomes the destination, publication failures still restore the prior output when possible.

This decision replaces only decision 0009's post-publication cleanup rule. After the verified stage
has become the live destination, failure to recursively delete the old backup does **not** restore
that possibly partially deleted backup over the verified new output. The new output remains live,
the typed export result records the retained backup path, and the application returns an `AFE001`
warning with recovery guidance. AF-060 still owns stale-operation recovery, locking, parent-directory
durability, and multi-writer arbitration.

Export results are generic over their immutable artifact type, preserving a precise AF-050
frame-sequence API while giving grid callers precise sheet and metadata paths.

## Consequences

- AF-051 delivers usable deterministic sheets for explicitly selected authored directions without
  claiming AF-052.
- Grid pixels, timing, events, and ordering cannot drift from AF-050 silently.
- Every persisted grid document is versioned despite the abbreviated Section 18.3 example.
- Successful publication may report recoverable backup debris instead of risking replacement with a
  partially deleted tree.
- The unmodified `default_grid` command becomes successful only when AF-052 supplies complete-frame
  mirroring and its spatial metadata contract.
- The from-scratch export demonstration remains AF-053.
