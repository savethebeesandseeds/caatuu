# 0009: Transactional frame-sequence export

- Status: accepted
- Date: 2026-07-21
- Ticket: AF-050

## Context

AF-050 is the first export slice. The specification requires the existing renderer, normative
frame sampling, per-frame PNG folders, metadata, verification, cancellation, and preservation of a
previous export on ordinary failure. It assigns grid spritesheets to AF-051 and complete-frame
mirroring to AF-052.

The only profile format currently specified is `animated-fabric.grid-spritesheet.v1`. Reusing that
identity for a folder sequence would be misleading because its metadata requires a sheet image and
frame rectangles. The specification also leaves rounding ties, integer-duration distribution,
event binning, resource ceilings, the exact destination boundary, and non-empty directory
replacement behavior unstated.

## Decision

### Format and destination

AF-050 owns a strict `animated-fabric.frame-sequence.v1` metadata document with schema version
`0.1.0`. The caller supplies the exact actor-scoped destination root. Each selected animation is
published beneath it as:

```text
<destination>/<animation>/<direction>/<index>.png
<destination>/<animation>/animation.json
```

Frame names have a minimum width of three digits. Metadata records the project slug, animation ID,
fixed frame size, ground-anchor origin, FPS, duration, ordered authored directions, frame count,
relative PNG path, exact integer duration, and events. Grid images, rectangles, trimming,
timestamps, sockets, hitboxes, equipment, and mirrored spatial metadata are not part of this format.

The selected animation set is one coherent export transaction. Re-exporting a subset replaces the
actor destination with exactly that subset, preventing stale files from masquerading as current
output. A destination inside the project must be a strict child of `exports/`; an external
destination is also allowed. Project ancestors, the project root, source data, unsafe links, and
non-directory destinations are rejected.

### Sampling and limits

Frame count follows section 11.5. Ties use integer half-to-even rounding, matching Python's stated
`round` behavior without floating-point drift. Frame times are `i * duration / frame_count` and
integer durations use adjacent cumulative floors, so every direction sums exactly to the clip
duration.

Events are assigned to half-open frame intervals. An event at exactly the duration belongs to frame
zero for a loop and the final frame for a non-looping clip; events beyond the duration remain an
`AFV305` warning and are omitted. This preserves between-sample events without changing pixels.

One export is bounded to 240 FPS, 4,096 rendered frames across animations and directions, and
512 MiB of uncompressed RGBA frame data. Existing project image limits continue to apply. These
ceilings bound CPU, memory, disk, and metadata growth while comfortably exceeding the MVP target.

### Transaction and failure model

The exporter creates a unique sibling staging directory on the destination filesystem. It renders
every PNG through the shared `Renderer`, verifies the exact PNG set and decodes every image as RGBA
with the expected size, then writes canonical JSON last and parses it back through the strict model.
Cancellation is checked before I/O, at each frame and metadata boundary, and immediately before
publication.

Publication first renames an existing destination to a unique sibling backup, then renames staging
into place. An ordinary promotion or cleanup failure attempts to restore the backup. Pre-publication
failure and cancellation remove owned staging output and leave the prior destination untouched.
The swap assumes a single writer: AF-060 still owns locking, crash recovery, and multi-process
arbitration. Filesystems do not provide a portable atomic exchange for non-empty directories, so a
process or machine crash between the two renames can leave the recoverable sibling backup visible.

Expected clipping uses `AFV501`, invalid settings use `AFV502`, and unsafe or unwritable
destinations use `AFV503`. Rendering, verification, cancellation, and publication failures use the
export boundary code `AFE001` with a typed `ExportFailureKind` retained internally.

## Consequences

- Preview and export use one renderer and one pixel contract.
- Frame timing, event placement, file ordering, JSON encoding, and output replacement are
  deterministic.
- A failed or cancelled export normally preserves the prior usable output.
- AF-050 does not expose the normative grid-profile CLI because that would claim AF-051 behavior.
- Grid spritesheets, mirroring, the public export command, and the from-scratch M5 demo remain
  explicitly assigned to AF-051 through AF-053.
