# Memory Moon scenery catalog provenance

The canonical human-readable provenance for the reusable scenery catalog lives
at `apps/launcher/static/assets/scenery/metadata/catalog.provenance.md`.
Runtime images live together under `../images/`, reproducibility inputs under
`../sources/`, and machine-readable contracts under the same `metadata/`
directory. Memory Moon consumes this shared catalog; neither the game nor the
launcher owns a second canonical copy.

The logical catalog ID remains `memory-moon-style-v1`. That ID describes the
art and metadata contract and is intentionally independent of the flattened
physical directory layout.

The adjacent visual vocabulary is the reviewed source and style authority, but
it is not a runtime dependency. Every authority image promoted for world use is
retained once under a semantic filename in `images/` and locked to its authority
path by SHA-256 in `catalog.manifest.json`. Runtime JSON contains only paths
inside the scenery tree.

## Style contract

The selected family uses a fixed three-quarter view, larger readable shapes,
heavy dark-brown ink, warm ochre wood and cream stone, moss and olive foliage,
restrained teal structures, amber practical lights, and sparing cyan magical
accents. Objects must have one reusable subject, a readable silhouette,
transparent padding, and an inspected ground anchor. Horizontal mirroring is
disabled because lighting and object asymmetry are authored in one direction.

Trees additionally follow the selected Clean Graphic contract: bold,
imperfect brown ink; broad foliage groups; two or three tonal bands; and a
species-specific silhouette that remains legible at game scale. A tree image
contains only the tree. Stones, benches, signs, lanterns, ornaments, hanging
gems, and other embedded props or accessories are excluded so each asset stays
independently reusable.

The archival grass and street sheets in the visual vocabulary are already
drawn as screen-projected diamonds. They are style references only. Applying
them to a horizontal 3D surface would project them twice, so active terrain is
derived from newly generated square, straight-down material images. Godot's
fixed 45-degree-yaw, 30-degree-elevation camera supplies the final diamond
projection.

## Five promoted authority objects

| Runtime image | Authority input | Transform |
| --- | --- | --- |
| `images/street-lamp.png` | `visual-vocabulary/burrow-review_036.png` | Exact copy |
| `images/village-well.png` | `visual-vocabulary/miscellaneous (145).png` | Exact copy |
| `images/trail-sign.png` | `visual-vocabulary/miscellaneous (118).png` | Exact copy |
| `images/flower-patch.png` | `visual-vocabulary/miscellaneous (202).png` | Exact copy |
| `images/tree-stump.png` | `visual-vocabulary/miscellaneous (203).png` | Exact copy |

These five authority paths, source hashes, promoted hashes, dimensions, byte
lengths, and rights state are recorded in `catalog.manifest.json`.
`catalog.json` owns gameplay scale, allowed scale range, ground anchor,
collision profile, occlusion policy, reuse limits, tags, and projection
compatibility.

Schema version 2 and catalog version 3 measure object heights against
`memory-moon-humanoid-v1`: a 1.4264-world-unit visible silhouette at runtime
model scale 0.78, backed by a 1.45-unit-high, 0.28-unit-radius movement capsule.
This shared reference replaces ad hoc per-layout object shrinking.

## Generated single objects

The active catalog has ten generated objects. OpenAI ImageGen's built-in mode
produced the moon bush and moss boulder on 2026-08-01. Their prompts used the
promoted natural objects as style references and required one standalone
subject, fixed projection, no cast shadow, clear bottom-center contact, and no
text or scene composition. Their original outputs remain
`sources/moon-bush.raw.png` and `sources/moss-boulder.raw.png`.

On 2026-08-02 the same built-in ImageGen workflow redrew the community tree and
refined the moon sapling. Both used `images/trail-sign.png` and
`images/village-well.png` as strict style references. The community tree also
referenced `visual-vocabulary/burrow-review_040.png`; the refined sapling
referenced the new community tree. This replaces the former exact-copy
community tree and supersedes the prior sapling raw output. The current inputs
are `sources/community-tree.raw.png` and `sources/moon-sapling.raw.png`.

The community-tree and sapling redraws favor larger coherent shapes, heavier
ink, and a restrained teal, ochre, and cream palette over fine generated
detail. Both raw outputs were processed in the existing Tukevejtso Linux
cutout environment with chroma removal, LANCZOS resizing, and binary alpha,
then returned to their same canvases and anchors. `images/community-tree.png`
remains 351 by 340 pixels with anchor y=310;
`images/moon-sapling.png` remains 374 by 452 pixels with anchor y=436. The
sapling is retained in catalog version 3 as a dormant rollback asset with no
active world placements.

Also on 2026-08-02, a controlled style study compared six ordinary species in
several treatments. Board B, Clean Graphic, was selected as the primary
authority and is retained unchanged as the non-runtime reference
`sources/tree-style-clean-graphic-reference.png`. The trail sign and village
well remain secondary authorities for line weight, palette, and material
language.

The chosen treatment produced one raw image and one transparent runtime image
for each ordinary species: oak, maple, birch, pine, willow, and poplar. The
Tukevejtso Linux preparation removes the chroma background, trims alpha,
resamples each visible tree to 420 pixels high with LANCZOS, restores 16 pixels
of transparent padding, and hardens the result to binary alpha. All six use a
bottom-center anchor at y=436. Their canonical world heights, relative to the
1.4264-unit humanoid, are oak 4.4, maple 4.2, birch 4.5, pine 5.1, willow 4.3,
and poplar 5.2 world units.

All ten generated objects remain `local-preview-only`. Their current raw
inputs, selected style authority, transformations, and output hashes are
locked by `metadata/catalog.manifest.json` and
`metadata/checksums.sha256`.

## Retained floor-material inputs

ImageGen also produced three opaque straight-down authoring inputs retained as
`sources/floor-grass-moss.raw.png`,
`sources/floor-grass-flowers.raw.png`, and
`sources/floor-earth-packed.raw.png`. Their deterministic preparations are
retained as `sources/floor-grass-moss.derived.png`,
`sources/floor-grass-flowers.derived.png`, and
`sources/floor-earth-packed.derived.png`; the packed intermediate is
`sources/floor-atlas.derived.png`. The crop, seam, alpha, and packing record is
preserved in `metadata/floor.processing.json`.

These files are non-runtime reproducibility inputs. The active world renders
only `images/terrain-atlas.png`, whose separate derivation is documented in
`world.provenance.md`; no legacy floor atlas or prepared tile is another
canonical runtime image.

## Rights and publication boundary

The visual-vocabulary README documents curation and embedding use, but it does
not identify an author, source URL, license, or redistribution grant. Project
policy says that project-local is not a license and the repository's AGPL does
not automatically cover artwork. Consequently the complete catalog remains
`local-preview-only`. It is appropriate for local composition and visual
evaluation, but it is a stop-ship input for public or paid distribution until
an owner-approved, path-and-hash-scoped grant is recorded.

Generated images use the same conservative `local-preview-only` gate. Do not
broaden that status by inference. Canonical repository storage does not assert
copyright ownership or expand any artwork license.

## Integrity and runtime isolation

- `metadata/catalog.json` is the reusable runtime object contract.
- `metadata/catalog.manifest.json` records immediate sources,
  transformations, rights, dimensions, byte lengths, and SHA-256 values.
- `metadata/checksums.sha256` locks canonical binary inputs and artifacts.
- `metadata/registry.json` identifies the active logical catalog and its
  consumer world.
- `metadata/catalog.schema.json` defines the strict catalog contract.
- `metadata/world.json` independently owns placements, navigation, terrain,
  spawn points, and routes.
- Runtime validation rejects direct visual-vocabulary, source, absolute,
  drive-letter, URL, and parent-traversal texture paths.
- Godot builds stage the active, hash-verified runtime allowlist into an
  ignored private workspace and exclude `sources/` entirely. That disposable
  staging area is not an asset authority.
