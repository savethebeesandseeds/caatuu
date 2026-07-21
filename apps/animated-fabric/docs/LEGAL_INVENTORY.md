# Animated Fabric legal inventory

**Last reviewed:** 2026-07-21

This inventory distinguishes first-party source, generated visual assets, adapted code, and
container tooling. Exact license texts and component records control if this summary differs from
them. A license on generated pixels does not relicense the software that produced them.

## First-party source and generated visuals

| ID | Material | Scope | Terms | Publication status |
|---|---|---|---|---|
| `SRC-001` | Animated Fabric first-party source, JSON, reports, tests, and documentation | `apps/animated-fabric/`, except material listed separately below | `AGPL-3.0-only`; repository [license](../../../LICENSE) | Public source under the stated terms |
| `VIS-001` | Four AF-052 phase-zero directional golden PNGs | The four files named in [`tests/golden/LICENSE-AF052-CC0.md`](../tests/golden/LICENSE-AF052-CC0.md) | `CC0-1.0`; owned procedural output, no attribution required | Approved for public reuse |
| `VIS-002` | AF-053 spritesheet, contact sheet, and review GIF | Official CI outputs `walk.png`, `walk_contact_sheet.png`, and `walk_review.gif` at the exact paths in [`AF053-DEMO-CC0.md`](AF053-DEMO-CC0.md) | `CC0-1.0`; owned procedural output, no attribution required | Approved for public CI publication and reuse |

`VIS-002` excludes the spritesheet JSON, directional manifest, provenance report, raw 48-frame
evidence sequence, source, container, and any independently modified file with the same basename.
Those exclusions remain `AGPL-3.0-only` when they are first-party material, or retain their own
third-party terms.

## Adapted and third-party components

| ID | Component | Scope and record | Terms | Distribution status |
|---|---|---|---|---|
| `SRC-002` | Adapted Tukevejtso cutout method | Copied-file inventory and source revision in [`tools/cutout/UPSTREAM.md`](../tools/cutout/UPSTREAM.md); notice in [`tools/cutout/LICENSE.tukevejtso`](../tools/cutout/LICENSE.tukevejtso) | MIT | Source notice retained; optional runtime remains separate |
| `SRC-003` | BiRefNet integration source | Notice in [`tools/cutout/LICENSE.birefnet`](../tools/cutout/LICENSE.birefnet); operational record in [`docs/CUTOUT.md`](CUTOUT.md) | MIT for the recorded source | Does not grant rights to model weights |
| `TOOL-001` | Blender 4.5.12 LTS and its container dependencies | Exact archive, checksum, upstream source, notices, and obligations in [`docs/third-party/blender.md`](third-party/blender.md) | Blender is GPL-3.0 as a whole; bundled components retain compatible terms | Container image is internal-only pending the recorded gates |
| `DEP-001` | Core and development Python dependencies | Compatibility ranges and purpose table in [`README.md`](../README.md); exact resolved Linux versions in project constraints | Per-package terms | Release notice/SBOM review remains a release gate |
| `MODEL-001` | Optional BiRefNet model weights | Project-owned cache populated only by the explicit provisioner; revision and hashes are documented in [`docs/CUTOUT.md`](CUTOUT.md) | Model-specific terms require separate review | Not committed, baked into images, or approved for redistribution |

## Publication rules

- Public CI may upload the three `VIS-002` media files with their CC0 notice plus the AGPL JSON
  reports needed to inspect them.
- CI must not upload the Blender container, extracted Blender distribution, complete untracked
  workspace, model cache, credentials, user art, or unreviewed generated candidates.
- Raw evidence remains an internal CI workspace unless a later decision and license notice name it
  explicitly.
- Any dependency, model, or container release still requires its own notices, corresponding source
  where applicable, SBOM, vulnerability review, and immutable identities.
