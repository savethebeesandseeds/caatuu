# 0015: Evaluate local image-to-3D reconstruction before manual actor authoring

- Status: accepted
- Date: 2026-07-23
- Ticket: AF-045
- Replaces: decision 0014's requirement to begin AF-056 with manual macaw
  modeling, only while the bounded AF-045 feasibility spike is evaluated

## Context

AF-052 and AF-053 proved that one 3D motion can produce every logical direction
by changing actor-root yaw. AF-054 and AF-055 then established rights-cleared
macaw references and a strict data-only actor-package validator. The attempted
next step concentrated on manually approximating the macaw with geometric
modeling. That work does not demonstrate Animated Fabric's intended value:
turning an ordinary character image into reusable motion without character-by-
character modeling sessions.

Current open models can propose a textured or vertex-colored mesh from one
image. They cannot recover invisible surfaces as truth, and different samples
do not share topology that can be averaged vertex by vertex. The useful
research question is narrower: can this computer generate a recognizable,
bounded proposal locally, then let deterministic validation and later rigging
turn the best proposal into an actor?

The available machine has an NVIDIA RTX A2000 Laptop GPU with 8 GiB VRAM,
32 GiB system RAM, and a Linux/amd64 Docker engine with NVIDIA passthrough.
This excludes larger current reconstruction and rigging systems, but fits the
documented approximately 6 GiB TripoSR baseline when run sequentially.

## Decision

Animated Fabric inserts AF-045 as a non-product research ticket and pauses
AF-056. The first baseline is pinned TripoSR in an application-owned Linux/CUDA
container:

```text
rights-cleared image
        |
        v
self-contained cutout -> reviewed RGBA
        |
        v
deterministic square/gray normalization
        |
        v
pinned TripoSR offline inference
        |
        v
immutable GLB proposal + hashes + parameters
        |
        v
structural/render review
        |
        v
go / revise / stop before rigging integration
```

The model source, checkpoint, auxiliary configuration, and CPU extraction
wheel are immutable identities. Model files are provisioned once through a
dedicated network-enabled command, verified against committed size and SHA-256
records, mounted read-only for inference, and never committed or baked into a
release image. Runtime inference has no network, public port, Docker socket,
host Python, or dependency on the normal Animated Fabric package.

Inputs are read-only. Every output remains an ignored `proposal` under
`workspaces/reconstruction/` until a human review and the existing actor-package
validator approve a deliberately normalized derivative. AF-045 does not weaken
that validator, accept arbitrary 3D as product input, or publish a model cache,
mesh, texture, or container.

## Candidate ensemble rule

TripoSR is feed-forward and has no useful random-seed ensemble. Initial
diversity may come from controlled preprocessing variants and, only after the
baseline is measured, other license-compatible reconstruction providers.

Candidates with different topology MUST NOT be averaged by vertex index.
Future consensus or fusion may compare fixed-view silhouettes, depth, normals,
identity similarity, topology, and deformation fitness. Geometry may be fused
only after canonical alignment in a shared point, voxel, or signed-distance
representation. Selecting the best valid candidate is an acceptable first
ensemble policy.

## Acceptance

AF-045 is complete only when:

- the Linux/CUDA image builds from pinned sources without installing anything
  on Windows;
- offline `doctor` verifies CUDA and every required model file;
- one approved macaw reference is processed through the self-contained cutout
  boundary and reconstructed without manual mesh edits;
- the candidate contains exactly a normalized input, vertex-colored GLB, and
  canonical provenance manifest;
- a second clean run records whether normalized input and mesh bytes repeat;
- observed runtime and peak CUDA allocation fit this computer;
- the normal development quality gate remains unchanged; and
- a written go/revise/stop result states whether to proceed to candidate
  scoring, introduce a second provider, or abandon local reconstruction.

## Decisions preserved

- ADR-001 remains true: hidden geometry is generated plausibility, never
  recovered fact.
- ADR-002 remains true for accepted 3D actors: directions come from direct
  actor-root yaw renders.
- ADR-004 remains true: Blender remains the eventual pixel authority for an
  accepted 3D prerender actor.
- ADR-009 remains true: cutout is optional, self-contained, and nondestructive.
- ADR-010 remains true: productive work runs in owned Linux containers.
- Decisions 0012 through 0014 and the accepted AF-053/AF-055 evidence remain
  unchanged.
- AF-056 through AF-059 are paused, not completed or deleted.

## Consequences

The spike tests the central automation assumption before further manual macaw
authoring. A recognizable GLB is not yet a rigged actor: skeleton estimation,
skin weights, retargeting, deformation validation, and candidate consensus are
separate decisions after AF-045. If the baseline fails on the approved macaw,
the project will have bounded evidence for changing models or stopping instead
of accumulating more bespoke geometry.
