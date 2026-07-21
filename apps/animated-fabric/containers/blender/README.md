# Experimental Blender worker

This image is the opt-in, headless Linux worker for the AF-044 feasibility spike. It renders one
repository-owned procedural humanoid for review. It is not an Animated Fabric importer, preview
renderer, exporter, development image, or product dependency. Its frames stay under an untracked
experimental output root and are not `ExportProject` artifacts.

## Pinned inputs

| Input | Identity |
|---|---|
| Build frontend | `docker/dockerfile:1` at the digest in `Dockerfile` |
| Base | `python:3.12-slim-bookworm` at the digest in `Dockerfile` |
| Blender | Official Blender 4.5.12 LTS Linux x64 archive |
| Archive | `https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz` |
| SHA-256 | `95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25` |

The remote archive is accepted only when Docker BuildKit verifies that exact SHA-256 checksum.
The image deliberately supports `linux/amd64` only. Blender's own Python runs the baked worker;
the Python installation in the base image is not the productive execution environment for it.

## Build on native Linux

Use the Animated Fabric directory as the build context:

```bash
docker build \
  --platform linux/amd64 \
  --build-arg APP_UID="$(id -u)" \
  --build-arg APP_GID="$(id -g)" \
  --file containers/blender/Dockerfile \
  --tag caatuu-animated-fabric-blender:4.5.12-cycles-cpu \
  .
```

`APP_UID` and `APP_GID` must both be non-zero. The example makes output ownership match the
non-root native-Linux caller.

Build-time network access retrieves Debian packages and the checksum-pinned Blender archive.
Runtime networking is prohibited. Native x86-64 Linux is the authoritative build and evidence
environment; emulation and Docker Desktop may be used only for non-authoritative smoke checks.

## Fixed runtime contract

The image always starts Blender with:

- background and factory-startup modes;
- automatic script execution disabled;
- Blender offline mode and audio disabled;
- Python failures mapped to reserved process exit code `10`; and
- the fixed, root-owned `/opt/animated-fabric/render_walk.py` worker.

The repository's `tools/blender/` directory is baked read-only into `/opt/animated-fabric`. The
entrypoint terminates Blender option parsing with `--`, so image arguments are worker arguments and
cannot add a `.blend`, startup file, add-on, or another Python script. The default worker arguments
are `--out /output/af044-demo`. Do not replace the entrypoint.

The Dockerfile supplies a non-root process and locked startup paths, but an orchestrator must
enforce the remaining runtime boundary. A native-Linux invocation has this shape:

```bash
mkdir -p .tmp/af044-output
timeout --signal=TERM 5m docker run --rm \
  --platform linux/amd64 \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 256 \
  --cpus 4 \
  --memory 4g \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g \
  --mount type=bind,src="$(pwd)/.tmp/af044-output",dst=/output \
  caatuu-animated-fabric-blender:4.5.12-cycles-cpu
```

The fixed worker enforces a 4 MiB ceiling on the 49 source-evidence files; the caller applies the
wall-clock timeout and should separately quota the host output filesystem when required. Do not
mount the Docker socket, the repository, a user home, `.blend` files, scripts, add-ons, fonts,
models, textures, HDRIs, or other third-party assets. Only the bounded experimental output
directory and fresh temporary storage are writable. No ports, display forwarding, audio device,
GPU, or input mount are needed.

The exact Dockerfile and Compose orchestrator recipe are baked into the image and hashed into every
evidence document. The base image and Blender archive are immutable inputs, but Debian runtime
packages currently come from the live Bookworm repositories rather than a dated snapshot. Record
the final image ID for each evidence run; a snapshot lock and SBOM remain mandatory before
distribution.

## License and distribution gate

Blender describes the complete application as licensed under GNU GPL Version 3; individual files
may carry different compatible licenses. The extracted distribution, including its notices,
remains intact under `/opt/blender`. Exact provenance, upstream source, corresponding-source
obligations, and the internal-only distribution gate are recorded in
[`docs/third-party/blender.md`](../../docs/third-party/blender.md).

Animated Fabric's first-party license is still pending. Do not publish this image until the worker
scripts have a compatible approved license, an image SBOM and complete notice inventory exist, and
the corresponding source for the exact Blender binary is offered in a GPL-compliant way.

To update Blender, change the version, URL, checksum, source record, labels, tests, and evidence as
one reviewed change. Never make the URL or checksum a convenient untrusted build override.
