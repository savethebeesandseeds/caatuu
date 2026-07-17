# 0001: Canonical layer manifest

- Status: accepted
- Date: 2026-07-17
- Ticket: AF-030

## Context

The specification requires every importer to produce `AssetLayer` values and to save a
`layers.manifest.json`, but it does not define that document's schema, location, or a field for it
in `ProjectManifest`. Extending `ProjectManifest` would create an unnecessary migration before any
released project uses the format. Keeping imported assets only in memory would make a successful
CLI import impossible to reopen deterministically.

## Decision

Each project may contain a fixed root-level `layers.manifest.json` with format
`animated-fabric.layer-manifest.v1`, a compatible `schema_version`, and a `layers` array of strict
`AssetLayer` values sorted by `asset_id`. Asset IDs, paths, and `(direction, semantic_part)` pairs
must be unique. `ProjectManifest` is unchanged; the fixed filename is an independent application
port implemented by the JSON repository.

The folder importer writes normalized PNGs beneath `source/layers/<DIRECTION>/` only during an
explicit reviewed import. It never replaces an existing PNG. A byte- and metadata-identical retry
is a no-op; conflicting content fails. New PNGs are staged inside the project, published without
overwrite, and rolled back if the manifest cannot be committed atomically.

A source folder may contain an optional file named `layers.manifest.json`; AF-030 tolerates that
entry but does not interpret it as mapping input because the specification defines no source-side
schema. User-confirmed mappings remain the authority.

## Consequences

- General asset catalogs can be reopened without changing the normative project manifest.
- Later rendering and rig tickets can depend on a small typed repository port.
- The root filename becomes a persistent v1 contract and will require migration if changed.
- Source-side mapping manifests remain explicit specification debt rather than an invented alias
  format.
