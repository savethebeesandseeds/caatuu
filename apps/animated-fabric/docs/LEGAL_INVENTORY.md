# Animated Fabric legal inventory

**Last reviewed:** 2026-07-22

This inventory distinguishes first-party source, generated visual assets, adapted code, and
container tooling. Exact license texts and component records control if this summary differs from
them. A license on generated pixels does not relicense the software that produced them.

## First-party source and generated visuals

| ID | Material | Scope | Terms | Publication status |
|---|---|---|---|---|
| `SRC-001` | Animated Fabric first-party source, JSON, reports, tests, and documentation | `apps/animated-fabric/`, except material listed separately below | `AGPL-3.0-only`; repository [license](../../../LICENSE) | Public source under the stated terms |
| `VIS-001` | Four AF-052 phase-zero directional golden PNGs | The four files named in [`tests/golden/LICENSE-AF052-CC0.md`](../tests/golden/LICENSE-AF052-CC0.md) | `CC0-1.0`; owned procedural output, no attribution required | Approved for public reuse |
| `VIS-002` | AF-053 spritesheet, contact sheet, and review GIF | Official CI outputs `walk.png`, `walk_contact_sheet.png`, and `walk_review.gif` at the exact paths in [`AF053-DEMO-CC0.md`](AF053-DEMO-CC0.md) | `CC0-1.0`; owned procedural output, no attribution required | Approved for public CI publication and reuse |
| `VIS-003` | AF-054 traveler-macaw reference art created from scratch for Caatuu | Only the eight PNG paths and SHA-256 values named in [`assets/reference-packages/macaw-traveler-v1/LICENSE-CC0.md`](../assets/reference-packages/macaw-traveler-v1/LICENSE-CC0.md); full lineage and limitations in [`reference.json`](../assets/reference-packages/macaw-traveler-v1/reference.json); exact separately supplied product-owner decision and open-reuse confirmation under evidence ID `CAATUU-AF054-OWNER-APPROVAL-2026-07-22` in [`review/source-approval.json`](../assets/reference-packages/macaw-traveler-v1/review/source-approval.json), with [`approval.json`](../assets/reference-packages/macaw-traveler-v1/approval.json) binding it to the manifest and ordered view set | `CC0-1.0` only for rights Caatuu owns or is authorized to exercise; no attribution required | Approved for public source, developer documentation, and offline modeling-reference use; embedded C2PA claims are recorded but not cryptographically validated |
| `VIS-004` | AF-055 geometric actor neutral golden | Only [`tests/golden/af055_actor_fixture_neutral.png`](../tests/golden/af055_actor_fixture_neutral.png) with SHA-256 `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`, as named by [`LICENSE-AF055-CC0.md`](../tests/golden/LICENSE-AF055-CC0.md); exact generation lineage is recorded in [`af055_actor_fixture_neutral.provenance.json`](../tests/golden/af055_actor_fixture_neutral.provenance.json) | `CC0-1.0`; owned geometric validation output, no attribution required | Approved for public source and reuse only at the exact tracked path and hash |

`VIS-002` excludes the spritesheet JSON, directional manifest, provenance report, raw 48-frame
evidence sequence, source, container, and any independently modified file with the same basename.
Those exclusions remain `AGPL-3.0-only` when they are first-party material, or retain their own
third-party terms.

## Unapproved authoring candidates

`VIS-003` is the sole AF-054 exception promoted from an ignored review workspace. Other turnaround
proposals, textures, meshes, actor packages, animations, renders, and macaw demo outputs remain
unapproved. Before any is accepted, its immutable source identities, generated-media provenance,
chosen terms, and exact publication scope MUST be added to this inventory. Candidate status is not
publication approval, and the `VIS-003` dedication must not be extended by filename similarity or
lineage alone.

## Internal AF-055 validation identities

| ID | Material | Exact generated identity | Terms | Publication status |
|---|---|---|---|---|
| `DEV-001` | Repository-generated geometric actor-package fixture and neutral worker evidence | Ignored workspace outputs recorded by [`af055_actor_fixture_neutral.provenance.json`](../tests/golden/af055_actor_fixture_neutral.provenance.json): `actor.glb` SHA-256 `e3079588a75b9553609ee41939119cd00b119e750706e29426eafc472f2bafa3`, `textures/albedo.png` SHA-256 `fd6abcd872a1f4ada38e541352dfac74452597072fc5fea5d9ad5450a01e94e6`, and worker `neutral.png` SHA-256 `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`; actor manifest SHA-256 `1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c` binds content-set SHA-256 `a84df998d86644671bcbde1f1723132fd1f2b3fac8288ed28debac8f9cb245c4` | First-party internal validation material; this record grants no publication terms, and the path-scoped `VIS-004` dedication does not extend to these workspace files | Internal CI evidence only; not uploaded or distributed |

`DEV-001` is a geometric validator fixture, not traveler-macaw geometry, source art, or an AF-056
actor. Its identity record does not extend the `VIS-003` clearance to any mesh, texture, package,
animation, or render.

## Adapted and third-party components

| ID | Component | Scope and record | Terms | Distribution status |
|---|---|---|---|---|
| `SRC-002` | Adapted Tukevejtso cutout method | Copied-file inventory and source revision in [`tools/cutout/UPSTREAM.md`](../tools/cutout/UPSTREAM.md); notice in [`tools/cutout/LICENSE.tukevejtso`](../tools/cutout/LICENSE.tukevejtso) | MIT | Source notice retained; optional runtime remains separate |
| `SRC-003` | BiRefNet integration source | Notice in [`tools/cutout/LICENSE.birefnet`](../tools/cutout/LICENSE.birefnet); operational record in [`docs/CUTOUT.md`](CUTOUT.md) | MIT for the recorded source | Does not grant rights to model weights |
| `SRC-004` | TripoSR, PyTorch, and PyMCubes reconstruction tooling | Exact TripoSR revision, pinned PyTorch and PyMCubes wheel identities, local patches, exclusions, and retained notices in [`tools/reconstruction/UPSTREAM.md`](../tools/reconstruction/UPSTREAM.md); container record in [`third-party/triposr.md`](third-party/triposr.md) | MIT for TripoSR; BSD-3-Clause for PyMCubes; PyTorch and transitive components retain their upstream terms | Internal optional image only; redistribution requires complete notices, SBOM, scan, and corresponding-source review |
| `TOOL-001` | Blender 4.5.12 LTS and its container dependencies | Exact archive, checksum, upstream source, notices, and obligations in [`docs/third-party/blender.md`](third-party/blender.md) | Blender is GPL-3.0 as a whole; bundled components retain compatible terms | Container image is internal-only pending the recorded gates |
| `DEP-001` | Core and development Python dependencies | Compatibility ranges and purpose table in [`README.md`](../README.md); exact resolved Linux versions in project constraints | Per-package terms | Release notice/SBOM review remains a release gate |
| `MODEL-001` | Optional BiRefNet model weights | Project-owned cache populated only by the explicit provisioner; revision and hashes are documented in [`docs/CUTOUT.md`](CUTOUT.md) | Model-specific terms require separate review | Not committed, baked into images, or approved for redistribution |
| `MODEL-002` | TripoSR checkpoint and DINO architecture configuration | Exact repositories, revisions, runtime-file sizes, and SHA-256 values in [`tools/reconstruction/model-manifest.json`](../tools/reconstruction/model-manifest.json) and [`RECONSTRUCTION_LAB.md`](RECONSTRUCTION_LAB.md) | TripoSR records MIT upstream; DINO and all transitive components retain separately recorded upstream terms | Separately provisioned internal cache only; not committed, baked into release images, redistributed, or sufficient to approve generated candidates |

## Publication rules

- Public CI may upload the three `VIS-002` media files with their CC0 notice plus the AGPL JSON
  reports needed to inspect them.
- The exact tracked `VIS-004` golden is public source under its scoped notice; CI must not upload the
  raw AF-055 actor package, generated texture, neutral worker render, or validation report.
- CI must not upload the Blender container, extracted Blender distribution, complete untracked
  workspace, model cache, credentials, user art, or unreviewed generated candidates.
- Raw evidence remains an internal CI workspace unless a later decision and license notice name it
  explicitly.
- Any dependency, model, or container release still requires its own notices, corresponding source
  where applicable, SBOM, vulnerability review, and immutable identities.
