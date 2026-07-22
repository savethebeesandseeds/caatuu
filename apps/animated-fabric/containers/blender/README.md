# Bounded Blender workers

This opt-in headless Linux image has two fixed final targets. `directional-worker` renders the
repository-owned procedural humanoid and walk from four direct actor-root yaws for frozen AF-053.
`actor-validator` accepts only the externally hash-pinned AF-055 geometric actor package, validates
it as data before import, and renders one fixed neutral frame. Neither target is an arbitrary
importer, interactive preview, development image, or base application dependency. The normal
development container independently verifies their output; the dependency and trust boundaries do
not merge.

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
  --target directional-worker \
  --file containers/blender/Dockerfile \
  --tag caatuu-animated-fabric-blender:4.5.12-cycles-cpu \
  .
```

Build the actor validator from the same pinned base with its separate fixed entrypoint:

```bash
docker build \
  --platform linux/amd64 \
  --build-arg APP_UID="$(id -u)" \
  --build-arg APP_GID="$(id -g)" \
  --target actor-validator \
  --file containers/blender/Dockerfile \
  --tag caatuu-animated-fabric-blender-actor-validator:4.5.12 \
  .
```

Both IDs must be nonzero. Build-time network access retrieves Debian packages and the
checksum-pinned Blender archive. Runtime networking is prohibited. Native x86-64 Linux is the
authority; emulation and Docker Desktop are convenience smokes only.

## Fixed AF-053 runtime contract

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

## Fixed AF-055 actor-validation contract

The separate `actor-validator` target always starts Blender with the same background,
factory-startup, auto-execution-disabled, offline, audio-disabled, and reserved-exit-code controls,
but bakes and selects only `/opt/animated-fabric/render_actor_package.py`. Arguments terminate after
`--`; the only worker option is a safe child destination beneath the fixed output root, and Compose
fixes the documented run to `/output/af055-neutral`. Arguments cannot select a `.blend`, package,
importer, script, renderer, motion, camera, light, or container option.

Compose mounts exactly:

- `workspaces/actor-packages/geometric-fixture-v1/` read-only at `/actor-package`; and
- `workspaces/blender/` read/write at `/output`.

The worker proves `/actor-package` is read-only from Linux mount metadata, reads singly linked
regular files without following links, copies their bounded bytes into a private `/tmp` snapshot,
rechecks the source tree for mutation, and verifies that snapshot against the manifest trust anchor
`1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c` before Blender sees the GLB.
The exact schema, GLB/PNG subset, coordinate mapping, and ceilings are normative in
[`docs/SPEC.md`](../../docs/SPEC.md#1510-reviewed-3d-actor-package-contract).

After import, a second gate rejects actions, drivers, NLA, constraints, linked libraries, imported
cameras/lights/speakers, packed or unexpected images, unsupported objects/modifiers, and decoded
count or world-bound drift. Only then does trusted worker code add its fixed orthographic camera and
lights and render the rest pose with Blender 4.5.12 LTS, EEVEE Next, 16 samples, one thread, and a
transparent 192 x 192 RGBA target. Publication is one closed transaction containing exactly:

```text
workspaces/blender/af055-neutral/
|-- neutral.png
`-- validation.json
```

The report binds package files, decoded observations, imported counts and bounds, renderer inputs,
output identity, isolation statements, and current trusted-source hashes. The reviewed neutral hash
is `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`.
This is a validator fixture, not traveler-macaw geometry or a general 3D-import path. AF-056 owns
the first rights-cleared macaw actor and `avian_v1`; AF-053 remains unchanged.

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
The geometric AF-055 neutral golden is separately covered by
[`LICENSE-AF055-CC0.md`](../../tests/golden/LICENSE-AF055-CC0.md). Neither dedication distributes,
approves, or relicenses the Blender image, and the AF-055 dedication does not cover future macaw
geometry or renders.

To update Blender, change the version, URL, checksum, source record, labels, tests, and evidence as
one reviewed change. Never turn the URL or checksum into a convenient untrusted build override.
