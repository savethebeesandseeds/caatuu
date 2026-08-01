# Shared scenery assets

This directory is Caatuu's single canonical repository home for scenery art,
object catalogs, versioned world layouts, schemas, integrity manifests, and
provenance. It is served locally below `/assets/scenery/`. Its physical location
under `apps/launcher/static/assets/` establishes a shared delivery boundary and
does not assign ownership to the launcher.

## Package organization

| Package | Purpose |
| --- | --- |
| `memory-moon-style-v1/` | Reusable objects, material sources, runtime catalog, integrity records, and style provenance. |
| `memory-grove-v6/` | Active Memory Grove reusable terrain atlas, tile-ID map, streamed layout, manifest, and provenance. |
| `memory-grove-v1/`, `memory-grove-v3/`, `memory-grove-v4/`, `memory-grove-v5/` | Reproducible, excluded design history and rollback packages. |
| `schemas/v2/` | Strict catalog and layout contracts used during validation. |

Memory Moon is a consumer of these packages, not their repository owner. Do not
create a persistent scenery copy inside a game project. Godot requires imported
resources to be project-local, so its Linux build and verification workflow may
copy only the active, hash-verified inputs into an ignored private project
workspace. Those copies are disposable build artifacts and must be recreated
from this directory.

The active terrain package is a real reusable tile system: `layout.json` maps
12 by 12 authored cells to a 20-entry atlas vocabulary instead of slicing one
full-map painting. Four grass variants and 16 cardinal path topologies can be
repeated across larger rectangular maps without changing the chunk streamer or
navigation resolution.

## Visual authority and promoted assets

`../visual-vocabulary/` remains the archival and visual authority for reviewed
source art. When an authority image is deliberately promoted for world use, its
semantic runtime form lives in a versioned scenery package and is linked to the
authority by path and SHA-256 in that package's manifest. This deliberate
promotion is not a license grant, and consumers must not make further canonical
copies.

## Rights boundary

Canonical repository storage describes where Caatuu maintains a file; it does
not assert copyright ownership or expand a license. Package-specific provenance
and rights fields remain normative. In particular, assets marked
`local-preview-only` remain blocked from public or paid distribution until the
documented release condition is satisfied.
