# Bounded Blender directional worker

This opt-in headless Linux image renders one repository-owned procedural humanoid and one fixed
walk from four direct actor-root yaws. It is not an arbitrary importer, interactive preview,
development image, or base application dependency. Blender produces a verified frame sequence;
the normal development container separately validates and packages those pixels for the bounded
AF-052 product path. AF-053 adds only a Linux-host shell command that invokes both containers; it
does not merge their dependency or trust boundaries.

## Pinned inputs

| Input | Identity |
|---|---|
| Build frontend | `docker/dockerfile:1` at the digest in `Dockerfile` |
| Base | `python:3.12-slim-bookworm` at the digest in `Dockerfile` |
| Blender | Official Blender 4.5.12 LTS Linux x64 archive |
| Archive | `https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz` |
| SHA-256 | `95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25` |

Docker BuildKit accepts the archive only when that exact checksum matches. The image supports
`linux/amd64` only. Blender's bundled Python runs the baked worker; the base image's Python is not
the productive Blender execution environment.

## Build on native Linux

Use `apps/animated-fabric` as the build context:

```bash
docker build \
  --platform linux/amd64 \
  --build-arg APP_UID="$(id -u)" \
  --build-arg APP_GID="$(id -g)" \
  --file containers/blender/Dockerfile \
  --tag caatuu-animated-fabric-blender:4.5.12-cycles-cpu \
  .
```

Both IDs must be nonzero. Build-time network access retrieves Debian packages and the
checksum-pinned Blender archive. Runtime networking is prohibited. Native x86-64 Linux is the
authority; emulation and Docker Desktop are convenience smokes only.

## Fixed runtime contract

The image always starts Blender with:

- background and factory-startup modes;
- automatic script execution disabled;
- offline mode and audio disabled;
- Python failures mapped to reserved exit code `10`; and
- the root-owned `/opt/animated-fabric/render_walk.py` worker.

The repository's `tools/blender/` sources are baked read-only. The entrypoint terminates Blender
option parsing with `--`, so arguments cannot add a `.blend`, startup file, add-on, or different
Python script. The AF-053 host command passes only `--out /output/af053-demo`; do not replace the
entrypoint.

Compose supplies a non-root user, no network, a read-only root, dropped capabilities,
`no-new-privileges`, bounded CPU/memory/process/shared-memory resources, fresh temporary storage,
and only `workspaces/blender/` mounted read/write at `/output`. Do not mount the Docker socket,
repository, home directory, user `.blend` files, scripts, add-ons, fonts, models, textures, HDRIs,
or other assets. No port, display, audio, GPU, or input mount is needed.

The worker enforces a 4 MiB ceiling across 50 hashed evidence files: 48 frames,
`walk/animation.json`, and `directional-prerender.json`. `provenance.json` is adjacent. The caller
owns the five-minute wall-clock timeout; `scripts/run_blender_directional_demo.sh` applies it for
AF-053. Operators should still quota the host output filesystem when needed.

The exact Dockerfile and Compose recipe are baked into the image and hashed into every evidence
document. The base image and Blender archive are immutable inputs, but Debian runtime packages
still come from live Bookworm repositories. Record the image ID for evidence runs; snapshot locks,
an SBOM, a scan, and complete notices remain distribution gates.

## License and distribution gate

Animated Fabric first-party source is `AGPL-3.0-only`. Blender describes the complete application
as GNU GPL Version 3, with some individual files under compatible terms. The extracted distribution
and notices remain intact under `/opt/blender`. Exact upstream and corresponding-source obligations
are recorded in [`docs/third-party/blender.md`](../../docs/third-party/blender.md).

The image remains internal-only until its SBOM, complete notice inventory, Debian snapshot policy,
vulnerability review, and GPL-compliant corresponding-source distribution are approved. The
official AF-053 CI `walk.png`, `walk_contact_sheet.png`, and `walk_review.gif` files are separate
first-party procedural outputs dedicated under the scoped
[`CC0-1.0` notice](../../docs/AF053-DEMO-CC0.md). JSON and source remain `AGPL-3.0-only`.
Publishing those generated pixels does not distribute, approve, or relicense the Blender image.

To update Blender, change the version, URL, checksum, source record, labels, tests, and evidence as
one reviewed change. Never turn the URL or checksum into a convenient untrusted build override.
