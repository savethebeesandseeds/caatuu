# 0013: Linux host orchestrates the bounded directional demo

- Status: accepted
- Date: 2026-07-21
- Ticket: AF-053
- Replaces: decision 0012's deferral of one-command orchestration and its public-distribution
  restriction for the three generated demo media files named below; all other decision 0012
  boundaries remain in force

## Context

AF-052 established all productive stages needed for one useful four-direction result: an isolated
Blender worker renders one repository-owned actor and walk, the normal development container
verifies the evidence and reviewed goldens, and the shared grid packer publishes a spritesheet and
metadata. Operators still had to invoke those stages separately, choose paths consistently, and
keep human-review media out of the immutable evidence root.

AF-053 must prove the approved path from scratch without turning product Python into a container
manager or pretending that the bounded 3D adapter is a general layered-project workflow. The
specification also requires a sample spritesheet and relevant reports as CI artifacts. The actor,
geometry, materials, motion, and review composition are first-party procedural work with no
external art assets, so the project owner has approved a narrow public-domain dedication for three
generated visual files. That permission does not make the Blender container distributable.

## Decision

### One Linux-host command

The supported entry point is:

```bash
bash scripts/run_blender_directional_demo.sh
```

The command runs from a native Linux host and derives the application root from its own location.
It accepts only `--skip-build`; actor, motion, renderer, scene, project, output path, and container
overrides are intentionally unavailable. The host must provide Docker with Compose, GNU `timeout`,
and `sha256sum`. It must run as a non-root user and use the real application-local
`workspaces/blender/` directory rather than a symbolic link.

By default, the script validates the Compose configuration and builds both
`animated-fabric-blender` and `animated-fabric-dev`. `--skip-build` is reserved for a deliberately
prebuilt pair, including the repeatability phase of the native workflow. Before rendering, the
script verifies that the Blender service resolves to a non-root numeric UID. It gives the render a
five-minute wall-clock limit and reports stable SHA-256 results only after every stage succeeds.

### Fixed stage ownership and outputs

The command uses exactly three sibling destinations under the ignored local workspace:

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

The Blender container owns only the evidence transaction at `af053-demo`. That root must contain
exactly `walk/`, `directional-prerender.json`, and `provenance.json` at top level; an extra file,
directory, or link invalidates it. The normal development container then verifies the source and
reviewed goldens, publishes the sibling review directory, and publishes the sibling product
directory. Keeping review media outside the source preserves a closed, immutable evidence set.

Review and product publication retain their independent verified directory transactions. AF-053
does not invent a cross-container distributed transaction: a later-stage failure preserves a
previous verified destination according to that stage's existing rules and reports failure. The
command assumes one writer. Locking, crash-recovery cleanup, and multi-writer arbitration remain
AF-060 work.

### Container and application boundary

Only the Linux host shell invokes Docker Compose. Blender remains the sole 3D frame authority; the
development container remains the verifier, review packager, and product packager. Product Python
does not invoke Docker, mount the Docker socket, import `bpy`, or acquire Blender dependencies. The
Blender worker remains offline, fixed-entrypoint, non-root, read-only, resource-bounded, and unable
to accept `.blend` files, scripts, add-ons, models, textures, fonts, HDRIs, or external motion.

The existing layered-2D command, schemas, `ExportProject`, and `OpenCvRenderer` do not change. This
script does not import a layered project, register a 3D source in the public CLI or GUI, or route a
general export request through Blender. General 3D actor input also remains out of scope.

### One motion and four directions

The orchestration adds no animation generation. It reuses AF-052's single immutable twelve-frame,
one-second `walk` tuple and fixed actor-root yaw table: `SE=-90`, `SW=180`, `NE=0`, and `NW=90`
degrees. Camera, geometry, materials, lighting, timing, and semantic events remain common. Every
view is rendered from the 3D actor; a finished 2D frame is never rotated, mirrored, or warped into
another direction. Mirror images exist only inside the independent difference measurements.

### Native CI and public artifacts

The path-scoped native x86-64 Ubuntu workflow builds the two images, executes the orchestration,
captures sorted hashes for evidence, product, and review trees, reruns the same fixed command, and
requires identical results with no stale files. The normal development-image quality gate remains
separate and continues to exclude Blender.

The public workflow artifact may contain these generated visual files only:

- `workspaces/blender/af053-product/walk.png`;
- `workspaces/blender/af053-demo-review/walk_contact_sheet.png`; and
- `workspaces/blender/af053-demo-review/walk_review.gif`.

Those three official AF-053 CI outputs are dedicated under `CC0-1.0` by
[`docs/AF053-DEMO-CC0.md`](../AF053-DEMO-CC0.md), which must accompany them. The product metadata,
directional manifest, provenance report, repository scripts, and other source remain
`AGPL-3.0-only`. The 48 raw evidence frames are not selected for publication by this decision.

The Blender container image and extracted Blender distribution remain internal-only until the
notice, corresponding-source, SBOM, Debian snapshot, vulnerability, and redistribution gates in
the Blender third-party record are satisfied. Publishing first-party generated pixels neither
publishes nor relicenses that container.

### Acceptance

AF-053 is accepted only when:

1. one clean Linux-host command builds or deliberately reuses the two images and completes render,
   verification, review, and product packaging without validation errors;
2. all three fixed roots have their exact regular-file layouts and contain no links or stale files;
3. the evidence proves one common motion fingerprint, all four direct actor-root yaws, matching
   schedules and events, and material differences between direct west views and 2D mirrors;
4. `walk.png` is a 2,304 x 768 RGBA sheet containing twelve 192 x 192 cells in each of four ordered
   rows, and `walk.spritesheet.json` preserves both foot-contact events;
5. every product cell equals its verified source frame and the two human-review files decode;
6. a second run in the same pinned native environment produces identical evidence, product, and
   review trees while eliminating deliberately introduced stale derived files;
7. the public CI artifact contains only the approved sample files, reports, and scoped license
   notice, never the Blender image or an unreviewed workspace; and
8. the unchanged normal Linux quality, fixture, demo, dependency, and package-install gates pass.

## Consequences

- One command demonstrates the fixed 3D actor from clean render through consumable spritesheet.
- The visible result remains one motion viewed at four actor-root yaws, not four generated walks.
- Exact sibling destinations make automation, review, cleanup, and CI comparison unambiguous.
- Three selected visual outputs can be viewed, shared, and reused without attribution under CC0;
  JSON and source remain AGPL, and the Blender image remains internal-only.
- AF-053 still does not provide a general 3D importer, public 3D project command, functional GUI,
  new actor, new motion, or layered-project orchestration.
- After authoritative native acceptance closes M5, AF-060 is the next permitted ticket.
