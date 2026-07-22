# Blender 4.5.12 LTS

## Component record

| Property | Value |
|---|---|
| Component | Blender |
| Version | 4.5.12 LTS |
| Architecture | Linux x86-64 (`linux/amd64`) |
| Binary archive | `https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz` |
| Binary SHA-256 | `95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25` |
| Checksum manifest | `https://download.blender.org/release/Blender4.5/blender-4.5.12.sha256` |
| Upstream source | `https://projects.blender.org/blender/blender/src/tag/v4.5.12` |
| Upstream project | `https://www.blender.org/` |
| License | GNU GPL Version 3 as a whole; individual files may have different compatible licenses |

Blender is used only inside two opt-in bounded headless workers. The frozen directional worker runs
the fixed repository-owned AF-053 procedural actor and walk without input. The separate AF-055 actor
validator accepts only the externally hash-pinned `geometric-fixture-v1` package through a read-only
mount, copies its bounded regular files into a private snapshot, completes standard-library
preflight before invoking Blender's glTF importer, applies a post-import behavior gate, and renders
one fixed neutral frame. Neither worker is linked into, imported by, or required by the Animated
Fabric Python package, development image, layered renderer, CLI, or GUI.

The active actor boundary is the exact `animated-fabric.actor-package.v1` and
`af055-bounded-core-gltf-v1` profile in [`docs/SPEC.md`](../SPEC.md#1510-reviewed-3d-actor-package-contract).
Its reviewed proof identities are manifest
`1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c`, content set
`a84df998d86644671bcbde1f1723132fd1f2b3fac8288ed28debac8f9cb245c4`, GLB
`e3079588a75b9553609ee41939119cd00b119e750706e29426eafc472f2bafa3`, texture
`fd6abcd872a1f4ada38e541352dfac74452597072fc5fea5d9ad5450a01e94e6`, and neutral render
`e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`.
The fixture is first-party geometric test data; it is not macaw art. AF-056 remains responsible for
human-reviewed macaw modeling, `avian_v1`, binding, weighting, and deformation acceptance.

No `.blend`, plug-in, Python, driver, expression, add-on, font, motion, external URI, embedded
animation, camera, light, speaker, linked library, or general third-party 3D asset is accepted.
Decision 0014 does not authorize arbitrary or untrusted import, and the AF-055 worker cannot select
its own script, renderer, camera, motion, destination, or container configuration.

## Image provenance and integrity

[`containers/blender/Dockerfile`](../../containers/blender/Dockerfile) uses the repository's
digest-pinned Python 3.12 Bookworm base and downloads the official x64 archive with Docker
BuildKit's `ADD --checksum`. A checksum mismatch fails the build. The archive is extracted without
modification, apart from removing any set-user-ID or set-group-ID permission bits; its license and
notice files remain in `/opt/blender`.

The build is intentionally restricted to `linux/amd64`. Authoritative evidence must be generated
on native x86-64 Linux; Docker Desktop or emulation is only a convenience smoke. Runtime is
non-root, headless, offline, audio-free, and starts with factory settings, automatic script
execution disabled, user script paths disabled, and one target-specific baked Python script.
Runtime isolation also supplies `--network none`, a read-only root filesystem, dropped
capabilities, `no-new-privileges`, CPU/memory/process/shared-memory limits, fresh `noexec` temporary
storage, and only a bounded writable evidence output mount. The AF-055 target adds the exact actor
package at `/actor-package:ro`; worker code confirms that mount is read-only before inspecting it.

The common image stage contains both repository-owned workers, but separate final Docker targets
fix their entrypoints: `directional-worker` for AF-053 and `actor-validator` for AF-055. The latter
publishes exactly `neutral.png` and canonical `validation.json`, with package identities, decoded
observations, imported counts and bounds, render settings, output hash, isolation declarations,
and current trusted-source hashes. The committed 192 x 192 RGBA golden is compared as decoded
pixels with maximum channel delta 2 and at most 0.1% changed pixels.

## Redistribution obligations

The internal experiment may build and inspect the image. Before anyone distributes the image or
its extracted Blender binary, the release owner must:

1. preserve Blender's copyright, license, and notice material;
2. obtain and retain the exact corresponding source for the shipped 4.5.12 binary, including the
   build scripts and component source required by the GPL;
3. provide that corresponding source through a GPL-compliant distribution method rather than
   treating an upstream hyperlink alone as the offer;
4. record checksums for the retained source and all published image identities;
5. generate and review an image SBOM, vulnerability scan, and complete third-party notice set; and
6. preserve the repository worker scripts and corresponding source under the root
   `AGPL-3.0-only` terms.

Animated Fabric first-party source is `AGPL-3.0-only`. The image nevertheless remains internal-only
until the other conditions above are resolved. The base image and Debian runtime libraries retain
their own licenses and must also appear in the generated notice and SBOM records.

This record summarizes the upstream license and is not a substitute for the exact license files in
the pinned archive. Those files control if this summary and the distribution ever differ.

## Deliberate update procedure

An update must select an official Blender release, pin its exact archive URL and verified SHA-256,
update the upstream source identity, rebuild on native Linux, and rerun both the complete AF-052
offline directional evidence/packaging/repeatability checks and the AF-055 actor preflight,
post-import, neutral-render, evidence, and decoded-golden checks. Version, checksum, targets,
labels, documentation, and evidence change together. Rollback means rebuilding the last reviewed
Dockerfile and archive checksum; floating tags, mutable download URLs, and unverified local
archives are not accepted.
