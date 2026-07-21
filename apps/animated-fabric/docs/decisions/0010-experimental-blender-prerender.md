# 0010: Experimental Blender prerender remains upstream tooling

- Status: accepted
- Date: 2026-07-21
- Ticket: AF-044

## Context

Animated Fabric may benefit from a 3D-to-2D prerender workflow for rapidly exploring motion,
camera consistency, silhouettes, and the difference between direct views and mirrored views.
Blender can answer those questions, but treating its output as product rendering would silently
change three non-negotiable contracts: layered PNG input in ADR-001, two authored plus two mirrored
directions in ADR-002, and the shared preview/export renderer in ADR-004.

AF-044 is therefore a bounded feasibility spike, not another product pipeline. It must provide
repeatable evidence without making Blender a dependency of the application, redefining project or
export schemas, or displacing M5 work.

## Decision

### Scope and authority

AF-044 creates exactly one repository-owned procedural 3D humanoid and one deterministic in-place
walk. A separate headless Blender tool keeps one orthographic camera fixed and renders direct
`SE`, `SW`, `NE`, and `NW` views by applying exact actor-root yaw rotations. The two direct
left-facing renders exist only to compare 3D view consistency and the visual consequences of the
current mirroring policy; they do not turn `SW` or `NW` into authored product directions.

Blender is experimental upstream tooling. It is not:

- a project importer or project format;
- an Animated Fabric preview or export renderer;
- a replacement for prepared layered PNG input;
- a source of product `SW` or `NW` direction behavior;
- a new animation, rig, or export schema; or
- a dependency of the core package, development image, CLI, GUI, or normal CI gate.

ADR-001, ADR-002, and ADR-004 remain normative without modification. M5 remains responsible for
product export through `ExportProject` and the shared `OpenCvRenderer` composition core.

### Experimental artifacts

The spike may arrange review-only RGBA frames using the strict AF-050 frame-sequence metadata,
sampling, direction ordering, and folder conventions so validation and comparisons are mechanical.
Those files remain under an explicitly experimental, untracked output root. Matching the existing
artifact contract does not make them `ExportProject` output, and they MUST NOT be promoted into a
product export destination. A separate provenance document identifies the experimental Blender
source and records stable relative paths rather than host-specific details. `animation.json` alone
is not sufficient provenance: any consumer of this evidence MUST require the adjacent
`provenance.json` and the explicitly experimental root, because the four direct views are not the
authored/mirrored product semantics defined by decision 0009.

The evidence set records:

- the procedural scene and walk parameters;
- camera transforms, orthographic scale, resolution, ground anchor, color management, render
  engine, device class, samples, and random seeds;
- Blender and container identities plus source and configuration hashes;
- ordered output paths and SHA-256 hashes;
- direct `SW` versus mirrored `SE`, and direct `NW` versus mirrored `NE`, comparison results;
- repeatability results from clean runs; and
- a clear go, revise, or stop recommendation.

Frames are evidence, not production art or reviewed Animated Fabric goldens. Generated workspaces,
cache data, `.blend` files, and candidate frame sets are not committed. The repository golden rule
applies to changes in the application renderer; AF-044 changes no product renderer and instead uses
two byte-repeatable runs, a human-review contact sheet, and a review GIF. Any later promotion into
product rendering requires reviewed committed goldens under the normal rule.

### Isolation, security, and supply chain

The Blender spike uses an opt-in Linux container/profile owned by Animated Fabric. It runs
non-root, headless, and without runtime networking, ports, the Docker socket, host Python, GPU
requirements, user startup files, or arbitrary add-ons. Repository and input mounts are read-only;
only a bounded experimental output root and temporary storage are writable. The runtime uses
factory startup with automatic script execution disabled, then invokes only the fixed
repository-owned procedural script explicitly. It does not open user-supplied or third-party
`.blend` files.

The implementation pins the base image by digest and Blender by exact version and verified
checksum. The worker hard-bounds resolution, frames, objects, and source-evidence bytes; Compose
bounds CPU, memory, process count, and temporary storage; and the authoritative evidence workflow
adds a five-minute timeout to each render. Output paths reject traversal and symbolic-link escape.
Locale, timezone, architecture, threading, seeds, render settings, and PNG settings are fixed
wherever they affect evidence.

The spike uses no external models, textures, materials, HDRIs, fonts, motion files, or plug-ins.
Blender describes the application as GNU GPL Version 3 as a whole; individual files can carry
different compatible terms, and the exact notices in the pinned archive control. Binary
provenance, corresponding-source obligations, and notices are recorded before an image is
distributed. Any repository script using Blender's Python API must have a compatible approved
license before public distribution; the internal spike does not resolve Animated Fabric's
still-pending first-party license.

### Acceptance

AF-044 is complete when:

1. the isolated image builds from pinned, verified inputs and runs offline;
2. one owned procedural humanoid and one in-place walk render direct `SE`, `SW`, `NE`, and `NW`
   frame sequences with transparent RGBA, fixed dimensions, and no external asset dependency;
3. two clean runs on the declared architecture produce the declared deterministic byte or decoded
   RGBA hashes, with any unavoidable difference measured and reported rather than hidden;
4. automated checks validate file count, signatures, dimensions, alpha, bounds, stable paths,
   hashes, provenance, and absence of timestamps or absolute paths in deterministic records;
5. the report compares direct left-facing views with mirrors and documents visual limitations,
   runtime, output size, licensing, and a go, revise, or stop conclusion;
6. the core dependency graph and product schemas remain unchanged, and the normal Linux quality
   gate still passes without Blender; and
7. no public product command, GUI control, final exporter, or claimed production asset is added.

A negative feasibility result satisfies the ticket when the evidence and failure mode are
reproducible and documented.

### Promotion boundary

No AF-044 result is promoted into the stable workflow automatically. Any proposal to accept 3D
source as product input, ship Blender-backed authoring, use directly rendered `SW`/`NW`, or publish
Blender frames as preview/export output requires a later ticket and an explicit replacement ADR
that names the affected parts of ADR-001, ADR-002, and ADR-004, including migration, testing,
security, licensing, and support consequences.

## Consequences

- The spike can measure 3D prerender value without creating a shadow application architecture.
- Four direct camera views are available for comparison while the product remains two-authored and
  two-mirrored.
- Core installation, projects, rendering, export, and M5 progress remain independent of Blender.
- Positive evidence creates an option, not an implicit commitment; negative evidence is still a
  useful completed result.
