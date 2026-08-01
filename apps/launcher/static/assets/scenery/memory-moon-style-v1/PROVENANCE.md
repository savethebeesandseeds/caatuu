# Memory Moon scenery style v1 provenance

This directory is a centralized Caatuu scenery package currently consumed by
Memory Moon. Its canonical repository home is
`apps/launcher/static/assets/scenery/memory-moon-style-v1/`; no game directory
owns or duplicates it. Its placement below the launcher establishes a shared
delivery boundary and does not imply launcher ownership.

The adjacent visual vocabulary is the source and style authority, but it is not
a runtime dependency. Every authority image promoted for world use is retained
here under a semantic filename and locked to that authority by SHA-256. Runtime
JSON contains only package-relative paths.

## Style contract

The selected family uses a fixed three-quarter view, dark brown ink, warm wood
and cream stone, moss and olive foliage, teal or oxidized-copper structures,
amber practical lights, and restrained cyan magical accents. Objects must have
one reusable subject, a readable silhouette, transparent padding, and an
inspected ground anchor. Horizontal mirroring is disabled because the lighting
and object asymmetry are authored in one direction.

The archival grass and street sheets are already drawn as screen-projected
diamonds. They are style references only. Applying them to a horizontal 3D
surface would project them twice, so the runtime floor uses newly generated
square, straight-down material textures. Godot's fixed 45-degree-yaw,
30-degree-elevation camera supplies the final diamond projection.

## Promoted authority objects

| Game object | Authority input | Transform |
| --- | --- | --- |
| `community-tree-a.png` | `burrow-review_040.png` | Exact copy |
| `street-lamp-a.png` | `burrow-review_036.png` | Exact copy |
| `village-well-a.png` | `miscellaneous (145).png` | Exact copy |
| `trail-sign-a.png` | `miscellaneous (118).png` | Exact copy |
| `flower-patch-a.png` | `miscellaneous (202).png` | Exact copy |
| `tree-stump-a.png` | `miscellaneous (203).png` | Exact copy |

Their authoritative repository paths, source hashes, copied hashes, dimensions,
and byte lengths are recorded in `manifest.json`. `catalog.json` owns gameplay
scale, allowed scale range, ground anchor, collision profile, occlusion policy,
reuse limits, tags, and projection compatibility.

## Generated single objects

OpenAI ImageGen's built-in generation mode produced one bush, one boulder, and
one sapling on uniform magenta backgrounds. Prompts used the copied natural
objects as style references and explicitly required one standalone subject,
fixed projection, no cast shadow, clear bottom-center contact, and no text or
scene composition.

The outputs were copied into the isolated Tukevejtso Linux image workspace at:

```text
C:/Work/tukevejtso/linux/workspaces/images/memory-moon-style-v1-20260801
```

The installed chroma-key helper used border auto-keying, a soft matte,
transparent threshold 12, opaque threshold 220, and despill. Pillow then
trimmed alpha, resized with LANCZOS, added 16 transparent safety pixels, and
wrote optimized RGBA PNGs. Original generated outputs remain under
`sources/imagegen/`; processed results live under `objects/`.

## Floor materials

ImageGen's built-in mode produced three opaque, straight-down source materials:
moss grass, sparse-flower grass, and packed earth. Each was deterministically
cropped and downsampled, then mirrored into a 256 by 256 tile. The separately
generated flower grass had a darker base value, so only its sparse pale petal
pixels are composited over `grass-moss-a`; this preserves variation without
exposing square cell boundaries. Opposing edge maximum RGB delta is exactly
zero for every tile. The three tiles are packed into one 1024 by 512 atlas with
eight-pixel edge-extruded gutters. That style atlas remains a reproducible
material-source contract. Active Memory Grove v6 deterministically derives a
separate layout-owned atlas with four grass variants and all 16 cardinal path
topologies, then repeats those entries through a streamed 12 by 12 tile-ID map.
The active world therefore does not depend on a map-sized painted floor.

The exact crop, alpha, seam, dimensions, hashes, and atlas rectangles are in
`metadata/processing-report.json`, `manifest.json`, and `catalog.json`.

## Rights and publication boundary

The visual-vocabulary README documents curation and embedding use, but it does
not identify an author, source URL, license, or redistribution grant. Project
policy says that project-local is not a license and the repository's AGPL does
not automatically cover artwork. Consequently this complete style package is
marked `local-preview-only`. It is appropriate for local composition and visual
evaluation, but it is a stop-ship input for public or paid distribution until
an owner-approved, path-and-hash-scoped grant is recorded.

Generated images are also kept `local-preview-only` in this package so the
release gate has one conservative status. Do not broaden that status by
inference.

Canonical repository storage describes where Caatuu maintains these files; it
does not assert copyright ownership or expand any artwork license.

## Integrity and runtime isolation

- `catalog.json` is the runtime object and tile contract.
- `manifest.json` records immediate sources, transformations, rights status,
  exact dimensions, byte lengths, and SHA-256 values.
- `SHA256SUMS` locks every binary source and promoted artifact.
- `../memory-grove-v6/layout.json` owns active placement, logical navigation,
  and the streamed reusable-tile contract; v4 and v5 remain design history.
- `../schemas/v2/` defines strict catalog and layout schemas.
- Runtime validation rejects paths outside this package, including direct
  visual-vocabulary, originals, absolute, drive-letter, URL, and
  parent-traversal texture paths.
- Godot builds may stage the active, hash-verified subset into an ignored
  private project workspace. That disposable staging area is not an asset
  authority.
