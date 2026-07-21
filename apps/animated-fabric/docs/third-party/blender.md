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

Blender is used only inside the opt-in bounded headless worker. It runs the fixed repository-owned
procedural actor and walk and is not linked into, imported by, or required by the Animated Fabric
Python package, development image, layered renderer, CLI, or GUI. Its verified RGBA sequence may
feed the separate AF-052 product packager in the normal development container. No third-party
`.blend`, plug-in, model, texture, font, motion, or other art asset is accepted.

Decision 0014 plans one rights-cleared, data-only macaw actor package. That boundary is not active
until AF-055 defines and tests its exact validation, read-only mount, supported GLB subset, resource
limits, and provenance. The current worker continues to reject external models and textures. AF-055
MUST update this record before any actor package is accepted; executable scene input remains
prohibited.

## Image provenance and integrity

[`containers/blender/Dockerfile`](../../containers/blender/Dockerfile) uses the repository's
digest-pinned Python 3.12 Bookworm base and downloads the official x64 archive with Docker
BuildKit's `ADD --checksum`. A checksum mismatch fails the build. The archive is extracted without
modification, apart from removing any set-user-ID or set-group-ID permission bits; its license and
notice files remain in `/opt/blender`.

The build is intentionally restricted to `linux/amd64`. Authoritative evidence must be generated
on native x86-64 Linux. Runtime is non-root, headless, offline, audio-free, and starts with factory
settings, automatic script execution disabled, user script paths disabled, and a fixed baked
Python script. Runtime isolation must also supply `--network none`, a read-only root filesystem,
dropped capabilities, `no-new-privileges`, resource limits, fresh temporary storage, and only a
bounded writable evidence output mount.

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
update the upstream source identity, rebuild on native Linux, and rerun the complete AF-052 offline
directional evidence, decoded-golden, packaging, and repeatability checks. Version, checksum,
labels, documentation, and evidence change together. Rollback means rebuilding the last reviewed
Dockerfile and archive checksum; floating tags, mutable download URLs, and unverified local
archives are not accepted.
