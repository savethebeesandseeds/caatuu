# Bounded Blender pipelines

This directory owns two isolated, fixed Blender paths. Frozen AF-053 constructs one low-poly
humanoid and analytical walk in trusted code, keeps one orthographic camera fixed, and changes only
actor-root yaw to rerender `SE`, `SW`, `NE`, and `NW`. AF-055 separately validates one externally
hash-pinned, repository-generated geometric actor package before import and renders one neutral
rest-pose frame. Neither path loads a `.blend`, motion file, add-on, font, or project-provided
script, and neither transforms a finished 2D frame to fabricate another direction.

The evidence boundary is recorded in
[decision 0010](../../docs/decisions/0010-experimental-blender-prerender.md), the narrow product
promotion in [decision 0012](../../docs/decisions/0012-directional-yaw-prerender.md), and the fixed
host orchestration in [decision 0013](../../docs/decisions/0013-end-to-end-directional-demo.md).
Blender image details and licensing are in the
[container README](../../containers/blender/README.md),
[third-party record](../../docs/third-party/blender.md), and
[legal inventory](../../docs/LEGAL_INVENTORY.md).

## Source and stage split

- `motion.py` is standard-library-only and defines every sampled joint, foot contact, event,
  direction yaw, duration, frame-sequence value, directional manifest, and stable motion digest.
- `render_walk.py` is the AF-053 module that imports Blender APIs. It constructs owned geometry,
  applies each immutable pose once before its four yaw renders, validates RGBA and alpha bounds,
  compares direct left-facing views with mirrors, and transactionally publishes evidence.
- `actor_package.py` is standard-library-only. It verifies the exact manifest trust anchor, closed
  regular-file tree, hashes, coordinates, compiled resource ceilings, PNG structure, and bounded
  core glTF subset before Blender can interpret any package byte.
- `render_actor_package.py` is the second and only other module that imports Blender APIs. It proves
  the read-only input mount, creates and validates a private snapshot, runs the fixed glTF import,
  rejects imported behavior or count/bound drift, and transactionally publishes one neutral frame
  plus validation evidence.
- `scripts/generate_actor_package_fixture.py` atomically produces the deterministic textured and
  skinned geometric proof package; `scripts/verify_blender_actor_neutral.py` closes and verifies the
  evidence tree and compares decoded pixels against the reviewed golden.
- `scripts/verify_blender_directional_goldens.py` compares decoded pixels with four reviewed
  phase-zero goldens and independently recomputes direct-view-versus-mirror differences.
- `scripts/package_blender_walk_demo.py` atomically creates a sibling contact sheet and synchronized
  GIF for human review from the same verified source sequence.
- `scripts/package_blender_directional_export.py` verifies evidence before and after packing,
  invokes the shared AF-051 grid packer, verifies every product cell against its source, and
  atomically publishes one PNG and one JSON document.
- `scripts/run_blender_directional_demo.sh` is the Linux-host entry point that invokes those fixed
  stages through Docker Compose and reports the final hashes.

Only `render_walk.py` and `render_actor_package.py` require `bpy`. Motion, package preflight,
evidence, golden, review, and packaging contracts otherwise run in the normal Linux development
image. Product Python does not invoke Docker, mount its socket, or import Blender APIs.

## AF-055 actor-package proof

Run this proof from `apps/animated-fabric` on a native non-root x86-64 Linux host. Docker Desktop is
useful for a convenience smoke but is not the evidence authority.

```bash
docker compose run --rm animated-fabric-dev \
  python scripts/generate_actor_package_fixture.py \
  --out workspaces/actor-packages/geometric-fixture-v1
docker compose --profile blender-actor build animated-fabric-blender-actor-validator
docker compose --profile blender-actor run --rm animated-fabric-blender-actor-validator
docker compose run --rm animated-fabric-dev \
  python scripts/verify_blender_actor_neutral.py \
  --source workspaces/blender/af055-neutral \
  --package workspaces/actor-packages/geometric-fixture-v1
```

The generator produces exactly `actor-package.json`, `actor.glb`, and
`textures/albedo.png`. The validator service mounts that package at `/actor-package:ro`, uses no
runtime network, runs as non-root with a read-only root and dropped capabilities, and writes only
to the bounded output mount. The external manifest trust anchor is
`1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c`; the content-set, GLB, and
texture hashes are respectively `a84df998d86644671bcbde1f1723132fd1f2b3fac8288ed28debac8f9cb245c4`,
`e3079588a75b9553609ee41939119cd00b119e750706e29426eafc472f2bafa3`, and
`fd6abcd872a1f4ada38e541352dfac74452597072fc5fea5d9ad5450a01e94e6`.

The closed result root contains only `neutral.png` and `validation.json`. The reviewed neutral PNG
is 192 x 192 RGBA with SHA-256
`e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`; verification permits a
maximum decoded channel delta of 2 and at most 0.1% changed pixels. The schema, GLB subset,
coordinates, ceilings, filesystem protections, and post-import gate are normative in
[`docs/SPEC.md`](../../docs/SPEC.md#1510-reviewed-3d-actor-package-contract).

This package is deliberately a striped box with a minimal two-joint skin. It proves validation and
ingestion, not macaw modeling, `avian_v1`, a walk, directional rendering, or general 3D import.
Those first three remain AF-056 through AF-058; general or untrusted import requires a later
decision. AF-053's worker, hashes, output contract, and product path remain frozen.

## Run the complete AF-053 path

Run from `apps/animated-fabric` on a native non-root Linux host:

```bash
bash scripts/run_blender_directional_demo.sh
```

The host requires Docker with Compose, GNU `timeout`, and `sha256sum`; it does not require Python,
Blender, Pillow, or project dependencies. The command validates Compose, builds
`animated-fabric-dev` and `animated-fabric-blender`, checks the Blender worker UID, renders with a
five-minute limit, verifies goldens and evidence, creates review media, packages the product, and
checks all six top-level result files before printing their SHA-256 values.

To repeat with the exact images already built deliberately:

```bash
bash scripts/run_blender_directional_demo.sh --skip-build
```

There are no actor, scene, motion, project, destination, or renderer flags. The command refuses a
root host identity, a root group, and symbolic-link workspace boundaries. Docker Desktop may be a
convenience smoke, but native x86-64 Linux CI is authoritative.

## Fixed outputs

The command publishes three sibling roots beneath the ignored workspace:

```text
workspaces/blender/
|-- af053-demo/
|   |-- directional-prerender.json
|   |-- provenance.json
|   `-- walk/
|       |-- animation.json
|       |-- SE/000.png ... 011.png
|       |-- SW/000.png ... 011.png
|       |-- NE/000.png ... 011.png
|       `-- NW/000.png ... 011.png
|-- af053-product/
|   |-- walk.png
|   `-- walk.spritesheet.json
`-- af053-demo-review/
    |-- walk_contact_sheet.png
    `-- walk_review.gif
```

The evidence root has exactly three top-level entries and may contain no extra file, directory, or
link. Its provenance covers exactly 50 hashed evidence files, capped together at 4 MiB: 48 frames,
`walk/animation.json`, and `directional-prerender.json`. The adjacent `provenance.json` records
their hashes and retains the historical AF-044 evidence identity.

`walk/animation.json` is the strict `animated-fabric.frame-sequence.v1` authority. The adjacent
`animated-fabric.directional-prerender.v1` document identifies the fixed actor, one motion digest,
the `actor_root_yaw` strategy, and ordered yaws `SE=-90`, `SW=180`, `NE=0`, `NW=90`. All four rows
share frame indexes, times, integer durations, and foot events.

The verified product is a 2,304 x 768 transparent RGBA sheet with twelve 192 x 192 cells in each of
four direction-major rows. `walk.spritesheet.json` records the same timing and events. Review and
product outputs are siblings rather than evidence children so their publication never opens or
mutates the closed source set.

## Repeatability and publication

The authoritative workflow runs the host command twice in one pinned native environment and
compares sorted hashes for the complete evidence, product, and review trees. The worker removes
volatile PNG ancillary chunks without re-encoding pixels, so same-environment runs are expected to
be byte-repeatable. Cross-host encoded bytes are measured rather than assumed; committed goldens
compare decoded RGBA pixels with an explicit tolerance.

The public CI artifact may include `walk.png`, `walk_contact_sheet.png`, and `walk_review.gif` under
the scoped [CC0 dedication](../../docs/AF053-DEMO-CC0.md), together with AGPL metadata and reports.
Raw directional frames are not selected for publication. This permission applies to generated
pixels only: the Blender container remains internal-only until its separate notice,
corresponding-source, SBOM, Debian snapshot, vulnerability, and redistribution gates are resolved.
