# Animated Fabric

## Master technical specification for implementation with Codex

| Property | Value |
|---|---|
| Document version | 0.4.0 |
| Status | approved normative plan |
| Date | July 21, 2026 |
| Repository location | `apps/animated-fabric` inside the Caatuu repository |
| Python package | `animated_fabric` |
| CLI executable | `animated-fabric` |
| GUI executable | `animated-fabric-gui` |
| Interface, documentation, identifiers, and code language | English |
| Authoritative execution environment | Linux containers |

---

## 0. How to read this document

This document is the technical contract for Animated Fabric. It exists so that Codex and human contributors can implement the system incrementally without guessing foundational decisions. It is not a broad product vision and it does not authorize work beyond the active ticket.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative:

- **MUST / MUST NOT:** mandatory for a task to be considered complete.
- **SHOULD:** a strong recommendation; any deviation requires a written reason.
- **MAY:** optional behavior.

This Markdown file is canonical. Any rendered document is a human-reading edition only. If the two disagree, this file wins.

### Recommended reading order

1. Sections 1 through 4: mission, scope, non-negotiable decisions, and architecture.
2. Sections 5 through 15: conventions, persistence, domain, rig, animation, rendering, import, and optional cutout.
3. Sections 16 through 21: GUI, CLI, export, quality, security, and repository infrastructure.
4. Sections 22 through 29: milestones, acceptance, execution protocol, risks, and glossary.
5. Appendices: complete examples, Python protocols, review checklist, and diagnostics.

### Contract precedence

When requirements appear to conflict, use this order:

1. safety and source preservation;
2. the current normative specification;
3. the active ticket acceptance criteria;
4. `AGENTS.md` execution rules;
5. documented defaults;
6. implementation convenience.

---

# 1. Mission and expected result

Animated Fabric is a desktop application and Python library that turns prepared layered 2D
illustrations or explicitly approved 3D prerender sources into reusable animated actors. It MUST
let a small team produce characters and creatures with an illustrated, isometric,
limited-animation aesthetic without drawing every frame manually.

The system separates three responsibilities:

1. **Appearance:** image layers or one approved, self-contained 3D actor source.
2. **Structure:** a hierarchical rig or the bounded actor hierarchy owned by its prerender adapter.
3. **Motion:** clips and parametric generators shared by actors in one anatomical family.

The primary output is a PNG sequence or fixed-cell spritesheet accompanied by JSON metadata. The game engine moves the actor through the world; Animated Fabric produces in-place actions such as `idle` and `walk`.

## 1.1 Primary success measure

The first useful version succeeds when one person can:

1. select a supported layered-2D or approved 3D prerender source;
2. define or reuse one canonical in-place motion;
3. preview four logical directions from the same rendering authority used for export;
4. export deterministic spritesheets and metadata;
5. verify that direction changes do not create new animation timelines; and
6. repeat the process for another actor while reusing compatible motion.

## 1.2 Guiding principle

Animated Fabric does not replace artistic judgment. It converts small, controlled artistic decisions into repeatable production. Automation MUST suggest and accelerate; it MUST NOT hide errors, fabricate missing source art without consent, or destroy source work.

---

# 2. Product scope

## 2.1 MVP scope

The MVP MUST include:

- a local, folder-based project with versioned JSON;
- import of transparent PNG layers;
- layered-2D support for authored `SE` and `NE` views and explicit legacy mirror declarations;
- a bounded 3D prerender path whose `SE`, `SW`, `NE`, and `NW` views reuse one motion and differ
  only by actor-root yaw;
- one reviewed traveler-macaw vertical slice whose versioned reference package, validated 3D actor
  package, `avian_v1` rig, and `avian_walk_v1` motion remain inside the isolated prerender plane;
- the `humanoid_v1` anatomical family;
- the `quadruped_v1` anatomical family before stable version 0.1 closes;
- rigid-part rigs with translation, rotation, and scale;
- pivots, a bone hierarchy, sockets, and draw slots;
- humanoid `idle` and `walk` generators;
- quadruped `idle` and `walk` generators;
- in-application preview;
- frame sequence, grid spritesheet, and JSON export;
- an equivalent CLI for validation, rendering, and export;
- undo and redo for editing operations;
- atomic save, autosave, and validation before export; and
- unit, integration, and golden-image tests.

## 2.2 Outside the MVP

The MVP MUST NOT require:

- automatic segmentation or background removal;
- automatic inpainting of hidden regions;
- mesh deformation or vertex skinning in the layered-2D renderer or editor;
- advanced inverse kinematics;
- cloth, hair, or tail physics;
- real-time clip blending;
- a complete painting editor;
- a game-engine-specific exporter;
- accounts, cloud services, telemetry, networking, or multi-user collaboration;
- a marketplace, third-party plugins, or execution of project-provided scripts.

The general MVP does not require arbitrary Blender files, unreviewed 3D import, automatic
single-image reconstruction, or an embedded 3D editor. AF-052 retains the fixed repository-owned
actor and walk proven by AF-044. Decision 0014 adds only one reviewed, data-only macaw actor package
and avian skinning inside the same isolated Linux prerender plane; Blender remains outside the base
runtime dependency set.

Background removal is an approved, self-contained optional capability described in ADR-009 and Section 15.7. Its availability MUST NOT make it a prerequisite for the prepared-layer workflow.

## 2.3 Intended users

### Art operator

The operator need not master traditional animation. They import layers, correct assignments, move pivots, tune parameters, and export.

### Game developer

The developer consumes spritesheets and JSON, automates exports through the CLI, and adds engine adapters.

### Animated Fabric developer

The contributor extends anatomical templates, generators, importers, exporters, and optional imaging capabilities without coupling them to the GUI.

---

# 3. Non-negotiable architecture decisions

## ADR-001: layered input before automatic segmentation

The stable workflow requires layered images. A composite image can hide surfaces that do not exist in visible pixels. No algorithm can reliably recover a complete arm hidden behind a torso without inventing art.

Therefore:

- layered import is normative;
- a manual Cut Studio is a later phase;
- background removal is optional assistance, never a condition of the primary workflow;
- generated masks and cutouts are proposals or derived assets; and
- source files are never overwritten.

This decision remains normative for the layered-2D path. Decisions 0012 and 0014 permit separate
bounded 3D prerender sources; neither claims that segmentation or a single view can reconstruct
hidden art or geometry.

## ADR-002: source-specific four-direction derivation

The initial logical direction set is `SE`, `SW`, `NE`, and `NW`.

- A layered-2D project may author and rig `SE` and `NE` and retain explicit `SW`/`NW` mirror
  declarations for backward compatibility.
- The approved 3D prerender path renders all four views directly from one canonical motion by
  changing only actor-root yaw.
- A 3D-derived direction MUST NOT be produced by rotating or mirroring finished pixels.
- A source path must declare its direction strategy explicitly; no exporter may silently switch it.

The fixed 3D path is defined by decision 0012. Decision 0014 adds one reviewed macaw through a
strict versioned actor-package contract. General 3D sources and any future replacement of legacy
layered mirroring remain out of scope.

## ADR-003: limited animation and world movement are separate

- Clips normally render at 12 frames per second.
- The game may run at 60 frames per second or higher.
- `walk` is an in-place animation.
- The game engine owns world position.
- The visual root MAY move by a few pixels but MUST NOT transport the actor across the map.

## ADR-004: one rendering authority per source path for preview and export

Preview and export MUST consume the same pixels from the same rendering authority for a given source
path. Maintaining independent preview and export implementations for one source is prohibited
because they would eventually disagree.

The reference renderer uses:

- `numpy` for matrices and buffers;
- `opencv-python-headless` for affine transforms;
- premultiplied alpha to prevent dark edges; and
- `Pillow` for PNG input, output, fixtures, and metadata where appropriate.

For each bounded 3D path, the isolated Blender worker is the frame authority. Human review and grid
export both consume its verified RGBA sequence; neither recreates the scene or motion. Blender does
not enter the base package or the layered-2D renderer. Decision 0014 permits only a validated,
read-only, data-only actor package; it does not permit executable scene input.

## ADR-005: a Qt-independent core

Models, evaluators, validators, importers, the renderer, exporters, and background-removal contracts MUST NOT import PySide6. The GUI depends on the core, never the reverse.

## ADR-006: projects are open, readable folders

Projects are folders containing JSON and PNG. The MVP uses neither a database nor a binary project container. Persisted paths are relative and use `/` separators.

## ADR-007: parametric generators produce explicit clips

A generator is not hidden renderer state. Running `animation generate` creates a normal `AnimationClip` containing editable tracks and keyframes. The clip can render later without rerunning its generator.

## ADR-008: deterministic by default

Given identical inputs, configuration, dependency versions, and execution architecture, export MUST produce identical pixels and SHOULD produce identical bytes. Exported files omit timestamps unless the user explicitly enables them.

## ADR-009: professional background removal is self-contained and optional

Animated Fabric MAY need professional foreground extraction when incoming artwork has a background. The proven Tukevejtso BiRefNet cutout method is the reference implementation, but Animated Fabric MUST be self-contained:

- the required adapter, preprocessing, postprocessing, tests, and configuration are vendored into this repository;
- Animated Fabric MUST NOT import from, invoke, or require a sibling Tukevejtso checkout;
- copied code and model use MUST preserve applicable license and attribution records;
- model weights MUST be pinned by immutable revision and checksum and MUST NOT be committed unless their license explicitly allows it;
- the normal application image and Python dependency set MUST NOT include PyTorch, Transformers, CUDA, BiRefNet, or model weights;
- the ML stack lives in an optional Linux container/profile owned by this repository;
- normal import of prepared transparent layers works when the optional container and model cache do not exist;
- source images are mounted or opened read-only and are never overwritten;
- results are written as derived RGBA PNGs and masks through an atomic operation;
- the capability performs no runtime network calls;
- device, engine revision, model revision, input hash, parameters, and diagnostics are recorded; and
- no Docker socket, public TCP port, cloud API, or host Python installation is permitted.

The initial integration MAY expose a project-local CLI and shared job directory rather than a resident service. A Unix-domain socket MAY be added later if GUI latency requires it. The boundary is the `BackgroundRemovalPort`, not a subprocess command embedded in domain code.

## ADR-010: Linux containers are the authoritative development environment

Animated Fabric remains within Caatuu at `apps/animated-fabric`, but it owns an independent Compose project, images, caches, and service names.

- Productive Python execution, dependency installation, formatting, typing, testing, fixture generation, rendering, packaging, and release builds MUST run in Linux containers.
- Windows MAY provide Git, the editor, Docker Desktop, and Docker/Compose invocation only.
- Contributors MUST NOT install project Python packages or native image/Qt/ML dependencies on the Windows host.
- Codex-bundled Python, Node.js, document runtimes, or ad-hoc host environments MUST NOT produce project artifacts or substitute for the project container.
- Linux CI using the same Docker build is authoritative.
- A Windows CI lane MAY verify portability or build a future Windows package, but it does not redefine the development baseline.
- Runtime containers have networking disabled. Controlled network access is allowed only while building or explicitly seeding pinned dependencies and model artifacts.
- Base images and production dependencies MUST be locked or pinned before a release.

---

# 4. General architecture

## 4.1 Logical layers

```text
┌─────────────────────────────────────────────────────────────┐
│ Presentation                                                │
│  PySide6 GUI                         Typer CLI              │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Application                                                 │
│  use cases, commands, validation, orchestration             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Domain                                                      │
│  project, rig, clip, geometry, diagnostics                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Infrastructure                                              │
│  JSON, PNG, OpenCV, repositories, exporters, optional ML   │
└─────────────────────────────────────────────────────────────┘
```

## 4.2 Primary data flow

```text
transparent PNG layers
        │
        ▼
LayerFolderImporter
        │  AssetLayer + manifest
        ▼
RigTemplateRegistry ──► RigDefinition
        │
        ▼
RigBindingService
        │
        ▼
AnimationGenerator ──► AnimationClip
        │
        ▼
AnimationEvaluator + PoseResolver
        │
        ▼
OpenCvCompositor
        │
        ├──► PreviewFrame
        └──► GridSpritesheetExporter + JSON
```

Optional preprocessing is separate:

```text
composite source image (read-only)
        │
        ▼
BackgroundRemovalPort
        │
        ▼
VendoredBiRefNetCutoutAdapter ──► derived RGBA PNG + mask + diagnostics
        │
        └──► normal layered import, after explicit user review
```

The bounded 3D prerender path is also separate:

```text
owned procedural 3D humanoid + one canonical in-place walk
        |
        v
isolated headless Blender directional worker
        |
        v
verified direct SE / SW / NE / NW RGBA frame sequence
        |
        +--> review media
        `--> shared verified grid packer --> product spritesheet + JSON
```

AF-044 established the evidence and isolation boundary. AF-052 and decision 0012 promote only that
fixed owned actor and walk: one precomputed pose tuple is rerendered at four actor-root yaws, then a
strict directional manifest and provenance gate the shared AF-051 grid packer. Arbitrary `.blend`
files, models, motions, scripts, and project-driven 3D rendering remain prohibited.

AF-053 and decision 0013 add one Linux-host shell command around those already approved stages. The
host shell invokes Docker Compose; Blender renders, and the normal development container validates,
creates review media, and packages the product. Product Python still neither invokes Docker nor
imports `bpy`, and this bounded command does not replace or impersonate layered-project orchestration.

Decision 0014 adds a reviewed macaw vertical slice without changing the accepted AF-053 demo:

```text
repository-held macaw candidate evidence
        |
        v
approved front / left / back / right reference package
        |
        v
human-reviewed mesh/material authoring --> validated actor package
        |
        v
avian_v1 skin --> avian_walk_v1
        |
        v
isolated headless Blender directional worker
        |
        v
verified direct SE / SW / NE / NW RGBA frame sequence
        |
        +--> review media
        `--> shared verified grid packer --> product spritesheet + JSON
```

The inferred views require explicit approval before modeling. The worker accepts no `.blend`,
script, driver, add-on, external URI, or embedded animation from the actor package. AF-054 through
AF-059 deliver this one rights-cleared actor; they do not create a general 3D importer.

## 4.3 Dependency rule

- `domain` may depend on the standard library and Pydantic.
- `application` may depend on `domain` and declared protocols.
- `infrastructure` implements application protocols and may depend on image libraries.
- `gui` and `cli` depend on `application`.
- No domain module imports GUI, concrete filesystem adapters, OpenCV, or ML libraries.
- Optional background-removal implementation code MUST remain behind `BackgroundRemovalPort` and an optional dependency/container boundary.

## 4.4 Primary services

| Service | Responsibility |
|---|---|
| `ProjectService` | create, open, save, migrate, and close projects |
| `ImportService` | incorporate layers, normalize names, and calculate metadata |
| `RigService` | apply templates, bind parts, and edit pivots and sockets |
| `AnimationService` | create clips, run generators, and validate tracks |
| `RenderService` | resolve poses and produce RGBA frames |
| `ExportService` | produce PNG files, spritesheets, and JSON |
| `ValidationService` | emit structured diagnostics and block severe errors |
| `BackgroundRemovalService` | optionally produce reviewed derived cutouts without changing sources |

---

# 5. Fundamental conventions

## 5.1 Units

| Quantity | Persisted unit |
|---|---|
| position | floating-point pixels |
| angle | floating-point degrees |
| scale | unitless factor |
| time | integer milliseconds |
| image size | integer pixels |
| opacity | number from 0 through 1 |

## 5.2 Coordinate system

- Canvas origin: top-left corner.
- X axis: positive to the right.
- Y axis: positive downward.
- Vectors are treated as columns.
- A positive angle rotates visually clockwise.
- JSON stores degrees; the renderer converts them to radians.

```text
R(a) = [ cos(a)  -sin(a)  0 ]
       [ sin(a)   cos(a)  0 ]
       [   0         0    1 ]
```

## 5.3 Transform composition

For a bone:

```text
local_bone = T(rest_position + animation_position)
             · R(rest_rotation + animation_rotation)
             · S(rest_scale × animation_scale)

world_bone = world_parent · local_bone
```

For a visual part:

```text
part_to_canvas = world_bone
                 · T(bind_offset)
                 · R(bind_rotation)
                 · S(bind_scale)
                 · T(-pivot_in_image)
```

This order is normative. Changing it changes every project.

## 5.4 Identifiers

- Semantic IDs use ASCII `snake_case`.
- Project slugs match `^[a-z][a-z0-9_]{2,63}$`.
- Project IDs are UUID v4.
- Bone, socket, generator, template, event, and diagnostic IDs are stable and are never translated.
- Historical ticket IDs such as `AF-001` and diagnostic codes such as `AFV203` remain stable.
- All visible text is English in the initial product. Localization MAY be added later.

## 5.5 Serialization and file namespace

- JSON is UTF-8, indented with 2 spaces, with a final newline.
- Paths are relative, contain no `..`, and use `/`.
- Lists with visual meaning preserve their order.
- Output dictionary keys are sorted when semantics are unchanged.
- Files are written through a sibling temporary and `os.replace`.
- Project metadata uses `.animated-fabric/`.
- New persistent formats use the `animated-fabric` schema namespace.

Canonical names:

| Artifact | Filename or suffix | Format identifier |
|---|---|---|
| project manifest | `project.animated-fabric.json` | `animated-fabric.project.v1` |
| rig | `*.animated-rig.json` | `animated-fabric.rig.v1` |
| animation clip | `*.animated-clip.json` | `animated-fabric.animation-clip.v1` |
| equipment catalog | `*.animated-equipment.json` | `animated-fabric.equipment-catalog.v1` |
| grid spritesheet metadata | `*.spritesheet.json` | `animated-fabric.grid-spritesheet.v1` |
| cutout operation record | `*.cutout.json` | `animated-fabric.cutout-operation.v1` |

No released persistent project exists under the former prototype namespace. The implementation MUST NOT introduce compatibility aliases unless a real user artifact requires migration.

---

# 6. Project format

## 6.1 Canonical tree

```text
my_character/
├── project.animated-fabric.json
├── source/
│   ├── original/
│   └── layers/
│       ├── SE/
│       │   ├── torso.png
│       │   ├── head.png
│       │   └── ...
│       └── NE/
│           ├── torso.png
│           ├── head.png
│           └── ...
├── derived/
│   └── cutouts/
│       ├── masks/
│       ├── rgba/
│       └── operations/
├── rig/
│   └── main.animated-rig.json
├── animations/
│   ├── idle.animated-clip.json
│   └── walk.animated-clip.json
├── equipment/
│   └── catalog.animated-equipment.json
├── exports/
└── .animated-fabric/
    ├── autosave/
    ├── cache/
    ├── jobs/
    └── project.lock
```

`source/` is immutable original material after import. Automatic operations MUST NOT modify it. Normalized and generated files live in `derived`, `rig`, `animations`, `exports`, or `.animated-fabric`. A cutout becomes a normal source layer only through an explicit reviewed import operation that copies it; history still records the original and operation metadata.

## 6.2 Project manifest

Normative example:

```json
{
  "format": "animated-fabric.project.v1",
  "schema_version": "0.1.0",
  "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
  "slug": "eva_mage",
  "display_name": "Eva, Forest Mage",
  "template_id": "humanoid_v1",
  "canvas": {
    "width": 192,
    "height": 192,
    "ground_anchor": [96.0, 160.0],
    "pixel_snap": "none"
  },
  "directions": {
    "SE": {"mode": "authored"},
    "SW": {"mode": "mirror", "source": "SE"},
    "NE": {"mode": "authored"},
    "NW": {"mode": "mirror", "source": "NE"}
  },
  "rig_path": "rig/main.animated-rig.json",
  "animation_paths": [
    "animations/idle.animated-clip.json",
    "animations/walk.animated-clip.json"
  ],
  "export_profiles": ["default_grid"],
  "selection_ellipse": {
    "center_offset": [0.0, -2.0],
    "radius_x": 20.0,
    "radius_y": 9.0
  }
}
```

## 6.3 Schema version control

- `schema_version` uses SemVer.
- Loaders accept the same major version and known minor versions.
- An unknown major version is rejected with a clear diagnostic.
- A migration writes a backup before modifying anything.
- No migration deletes sources.
- `format` is required and prevents one JSON artifact type from being parsed as another.

## 6.4 Locking and autosave

- Opening in write mode creates `.animated-fabric/project.lock`.
- The lock contains PID, host, container identity, and an informational date.
- If it exists, the GUI offers read-only open or recovery.
- Autosave runs 2 seconds after the last modification, with debounce.
- Manual save atomically replaces JSON and removes the corresponding autosave.
- A host PID alone MUST NOT be treated as authoritative across container boundaries; stale-lock handling verifies ownership and offers recovery.

---

# 7. Domain model

## 7.1 Base types

```python
class Vec2(BaseModel):
    x: float
    y: float


class Transform2D(BaseModel):
    position: Vec2 = Field(default_factory=lambda: Vec2(x=0.0, y=0.0))
    rotation_deg: float = 0.0
    scale: Vec2 = Field(default_factory=lambda: Vec2(x=1.0, y=1.0))
```

Persisted models use strict validation. Mutable default instances are prohibited.

## 7.2 `AssetLayer`

| Field | Type | Rule |
|---|---|---|
| `asset_id` | string | unique within the project |
| `direction` | enum | `SE`, `SW`, `NE`, `NW` |
| `semantic_part` | string | template name or free semantic name |
| `path` | string | relative to project root |
| `source_canvas_size` | `IntSize` | logical size before trimming |
| `trim_origin` | `IntPoint` | crop location within source canvas |
| `trim_size` | `IntSize` | stored PNG size |
| `sha256` | string | cache invalidation hash |
| `optional` | bool | permits absence without an error |

Import MAY trim transparency but MUST preserve `trim_origin` so the original position can be reconstructed.

## 7.3 `BoneDefinition`

| Field | Type | Rule |
|---|---|---|
| `bone_id` | string | semantic and stable |
| `parent_id` | string or null | tree MUST NOT contain cycles |
| `rest_transform` | `Transform2D` | relative to parent |
| `length_hint` | float or null | visual aid; does not affect rendering |
| `locked` | bool | prevents accidental editing |

## 7.4 `PartBinding`

| Field | Type | Rule |
|---|---|---|
| `part_id` | string | unique |
| `semantic_part` | string | for example `upper_arm_l` |
| `bone_id` | string | controlling bone |
| `assets_by_direction` | map | direction to `asset_id` |
| `pivot_by_direction` | map | pivot within trimmed image |
| `bind_transform` | `Transform2D` | adjustment relative to bone |
| `draw_slot` | string | semantic visual slot |
| `slot_order` | int | stable tie breaker |
| `visible` | bool | base value |
| `opacity` | float | base value |

Multiple parts MAY depend on one bone. This supports torso, clothing, and armor layers sharing motion.

## 7.5 `SocketDefinition`

```json
{
  "socket_id": "hand_r_weapon",
  "bone_id": "hand_r",
  "local_transform": {
    "position": [4.0, 2.0],
    "rotation_deg": 8.0,
    "scale": [1.0, 1.0]
  },
  "default_draw_slot": "weapon_front"
}
```

Sockets are attachment points. Equipment does not modify the base rig.

## 7.6 `DirectionProfile`

Each authored direction may adjust:

- bone rest transforms;
- part visibility;
- asset selection per part;
- pivots;
- slot order; and
- optional track multipliers.

In the layered-2D schema, a mirrored direction needs no assets and retains its declared authored
source. This declaration does not apply to the 3D prerender path, whose views are direct yaw renders.

## 7.7 `RigDefinition`

```json
{
  "format": "animated-fabric.rig.v1",
  "schema_version": "0.1.0",
  "rig_id": "main",
  "template_id": "humanoid_v1",
  "bones": [],
  "parts": [],
  "sockets": [],
  "direction_profiles": {},
  "draw_slot_profiles": {}
}
```

The validator MUST verify:

- unique IDs;
- existing parents;
- no cycles;
- exactly one `root`;
- parts bound to existing bones;
- pivots within reasonable limits;
- existing assets;
- known slots; and
- a resolvable draw order for every visible part.

---

# 8. Input art contract

Visual stability begins before code. A badly prepared layer may be technically valid but produce a broken puppet.

## 8.1 Required views

For layered-2D four-direction isometry:

- `SE`: front-diagonal facing right;
- `NE`: rear-diagonal facing right;
- `SW`: mirrored from `SE`;
- `NW`: mirrored from `NE`.

`SE` and `NE` MUST share apparent height, scale, ground contact position, proportions, palette, and line weight.

The bounded 3D actor instead uses one fixed camera and one actor. Its four views are generated from
the yaw table in decision 0012, so apparent scale, anchor, geometry, materials, lighting, timing,
and motion remain common across directions.

## 8.2 Canvas and resolution

- Default logical canvas: 192 × 192 px.
- Default ground anchor: `[96, 160]`.
- Art SHOULD be produced at 2× or 4× and reduced with a defined filter.
- Reduction occurs before import or through an explicit reproducible operation.
- No part should touch the canvas edge in the neutral pose.

## 8.3 Joint overlap

Every moving piece MUST extend beneath its neighbor: arm beneath sleeve or torso, thigh beneath skirt or pelvis, neck beneath head and torso, leg beneath body, and tail beneath rump.

Recommended extension is 6 to 12 pixels on a 192 px canvas. The pivot belongs inside this hidden region. This prevents gaps during rotation.

## 8.4 Hidden surfaces

A separate part MUST contain its complete intended shape, including normally hidden portions. Cutting an arm directly from a composite usually produces an incomplete arm. Neither manual nor automatic extraction can guarantee reconstruction of pixels that do not exist.

## 8.5 Shadows and effects

- The ground shadow is an independent layer normally bound to `root`.
- Weapon shadows MUST NOT be baked onto the body if the weapon is interchangeable.
- Highlights, particles, and trails are separate effects in later phases.

## 8.6 Folder and naming convention

```text
source/layers/SE/head.png
source/layers/SE/torso.png
source/layers/SE/upper_arm_l.png
source/layers/SE/lower_arm_l.png
source/layers/SE/hand_l.png
...
source/layers/NE/head.png
...
```

Accepted import aliases MAY include legacy or source-language names:

| Canonical | Suggested aliases |
|---|---|
| `upper_arm_l` | `left_upper_arm`, `arm_l_upper`, `l_upper_arm` |
| `lower_arm_l` | `left_forearm`, `forearm_l`, `l_lower_arm` |
| `thigh_r` | `right_thigh`, `upper_leg_r`, `r_upper_leg` |
| `foot_r` | `right_foot`, `r_foot` |

The importer proposes matches; the user confirms them. Persisted canonical identifiers remain English.

## 8.7 Minimum humanoid profile

Required:

- `torso`, `head`;
- `upper_arm_l`, `lower_arm_l`, `hand_l`;
- `upper_arm_r`, `lower_arm_r`, `hand_r`;
- `thigh_l`, `shin_l`, `foot_l`; and
- `thigh_r`, `shin_r`, `foot_r`.

Optional:

- `pelvis_visual`, `neck_visual`;
- `hair_back`, `hair_front`;
- `cape`, `ground_shadow`; and
- additional garments.

## 8.8 Reviewed 3D reference package

The macaw bridge stages review candidates under `.tmp/af054-review/`. After approval and rights
clearance, its canonical tracked reference package is
`assets/reference-packages/macaw-traveler-v1/`. It MUST:

- preserve every original source and record its SHA-256;
- contain individually hashed `front`, `left`, `back`, and `right` files at a common canvas, scale,
  and ground line under actor axes `+Y` forward, `+X` anatomical right, and `+Z` up; the cameras are
  respectively at `+Y`, `-X`, `-Y`, and `+X`, with the left beak pointing screen-left and the right
  beak pointing screen-right;
- treat a combined review sheet as convenience and record exact crop rectangles when one exists;
- identify generated or otherwise inferred views as proposals;
- record the selected gait style as `anthropomorphic_traveler`;
- record the candidate prop scope `staff_separate`, with the staff omitted from the first actor and
  walk but a compatible hand socket reserved for later equipment work;
- keep provenance for every source and derivative; and
- remain `candidate` until a separate human approval record names the exact manifest SHA-256,
  ordered view-set digest, decision, UTC date, and reviewer role.

A cutout or single view MUST NOT be interpreted as recovered hidden geometry. AF-056 MUST reject a
reference package that is unapproved, incomplete, ambiguously ordered, or missing provenance.

---

# 9. Anatomical templates

## 9.1 Template registry

`RigTemplateRegistry` loads built-in templates from JSON resources. Each template declares:

- bone IDs and hierarchy;
- required and optional parts;
- import aliases;
- default sockets;
- draw slots;
- compatible generators; and
- limits and initial values.

A template is data, not executable code.

## 9.2 `humanoid_v1`

Normative hierarchy:

```text
root
└── pelvis
    ├── torso
    │   ├── neck
    │   │   └── head
    │   ├── upper_arm_l
    │   │   └── lower_arm_l
    │   │       └── hand_l
    │   └── upper_arm_r
    │       └── lower_arm_r
    │           └── hand_r
    ├── thigh_l
    │   └── shin_l
    │       └── foot_l
    └── thigh_r
        └── shin_r
            └── foot_r
```

Initial sockets:

- `head_hat`
- `head_face`
- `back_cape`
- `hand_l_item`
- `hand_r_weapon`
- `hand_l_shield`
- `waist_item`
- `root_shadow`

## 9.3 `quadruped_v1`

Normative hierarchy:

```text
root
└── body
    ├── chest
    │   ├── neck
    │   │   └── head
    │   │       └── jaw
    │   ├── front_upper_l
    │   │   └── front_lower_l
    │   │       └── front_paw_l
    │   └── front_upper_r
    │       └── front_lower_r
    │           └── front_paw_r
    └── hips
        ├── hind_upper_l
        │   └── hind_lower_l
        │       └── hind_paw_l
        ├── hind_upper_r
        │   └── hind_lower_r
        │       └── hind_paw_r
        └── tail_0
            └── tail_1
```

`jaw` and `tail_1` are optional. A highly stylized body MAY bind chest and hips to one visual image while retaining separate bones.

## 9.4 `avian_v1`

The first avian profile is an upright anthropomorphic bird, not a natural four-legged gait.

```text
root
`-- pelvis
    |-- torso
    |   |-- neck
    |   |   `-- head
    |   |       `-- beak
    |   |-- wing_upper_l
    |   |   `-- wing_lower_l
    |   |       `-- wing_hand_l
    |   |-- wing_upper_r
    |   |   `-- wing_lower_r
    |   |       `-- wing_hand_r
    |   `-- tail_base
    |       `-- tail_mid
    |           `-- tail_tip
    |-- thigh_l
    |   `-- shin_l
    |       `-- foot_l
    `-- thigh_r
        `-- shin_r
            `-- foot_r
```

`beak`, both `wing_hand` bones, and `tail_tip` MAY have no weighted vertices when a reviewed actor
does not need them, but their transforms remain stable motion and attachment targets. Initial
sockets are `head_hat`, `back_pack`, `wing_hand_l_item`, `wing_hand_r_item`, and `root_shadow`.

The isolated 3D actor validator MUST require explicit joint mapping, finite normalized skin
weights, bounded influences per vertex, a single actor root, and a reviewed neutral bind pose.
This template does not authorize mesh deformation in the layered-2D renderer.

## 9.5 Applying a template

The rig service:

1. creates bones with initial positions proportional to the canvas;
2. maps assets by semantic name;
3. estimates pivots from the manifest or relative template defaults;
4. creates bindings;
5. creates sockets;
6. builds `SE` and `NE` profiles; and
7. emits diagnostics for missing elements.

Applying a template MUST NOT overwrite an existing rig without explicit use-case confirmation.

---

# 10. Draw-order system

A global `z_index` is insufficient. Draw order changes with direction and equipment.

## 10.1 Draw slots

Each part belongs to a semantic slot, for example:

```text
ground_shadow
cape_back
weapon_back
leg_far
leg_near
body_back
torso
arm_far
head_back
head
hair_front
arm_near
shield_front
weapon_front
fx_front
```

Each direction profile defines an ordered slot array. Within a slot, parts are sorted by `slot_order`, then by `part_id` for determinism.

## 10.2 Animation overrides

A part track MAY add an integer `z_bias` during a clip. Moving between slots mid-animation is reserved for a later version. Complex attacks may split a weapon into `weapon_back` and `weapon_front` or use dedicated sprites.

## 10.3 Validation

- Every visible part has a slot.
- Every used slot appears in the profile or declares a fallback.
- Unknown slots are errors.
- Final ordering is stable.

---

# 11. Animation system

## 11.1 `AnimationClip`

```json
{
  "format": "animated-fabric.animation-clip.v1",
  "schema_version": "0.1.0",
  "clip_id": "walk",
  "display_name": "Walk",
  "template_id": "humanoid_v1",
  "duration_ms": 800,
  "loop": true,
  "fps_hint": 12,
  "tracks": [],
  "events": [
    {"time_ms": 0, "event": "foot_contact_l"},
    {"time_ms": 400, "event": "foot_contact_r"}
  ],
  "generator_provenance": {
    "generator_id": "humanoid_walk_v1",
    "parameters": {}
  }
}
```

`generator_provenance` is informational. The clip evaluates exclusively from its tracks.

## 11.2 Tracks

| Field | Description |
|---|---|
| `target_type` | `bone` or `part` |
| `target_id` | bone or part ID |
| `property` | animated property |
| `value_mode` | `delta` or `absolute` |
| `keys` | ordered keyframes |

MVP bone properties:

- `position_x`, `position_y`;
- `rotation_deg`; and
- `scale_x`, `scale_y`.

MVP part properties:

- `opacity`;
- `visible`; and
- `z_bias`.

The default bone mode is `delta`, which makes clips reusable over different rest poses.

## 11.3 Keyframes

```json
{
  "time_ms": 200,
  "value": 14.0,
  "interpolation": "smooth"
}
```

MVP interpolation modes:

- `step`;
- `linear`; and
- `smooth`.

`smooth` uses `u²(3-2u)` between keyframes. Bézier curves and tangent editors are outside the MVP.

## 11.4 Time evaluation

- Keys are sorted by `time_ms`.
- Two keys at one time are an error.
- For looping clips, `t` is reduced modulo `duration_ms`.
- Evaluation at `duration_ms` equals 0 for loops.
- A track without an earlier key uses its first key.
- A track without a later key uses its last key.
- Missing channels use the identity delta.

## 11.5 Export sampling

```text
frame_count = max(1, round(duration_ms × fps / 1000))
frame_i_time = i × duration_ms / frame_count
for i = 0 ... frame_count - 1
```

Looping clips do not export a duplicate frame at `duration_ms`. Integer frame durations in JSON are distributed so their sum is exactly `duration_ms`.

## 11.6 Events

Events do not alter the image. They are exported as metadata, including:

- `foot_contact_l`;
- `foot_contact_r`;
- `blink`;
- `attack_hit`; and
- `sound:<id>` in later versions.

Consumers may ignore them.

---

# 12. Parametric generators

## 12.1 Contract

```python
class AnimationGenerator(Protocol):
    generator_id: str
    template_id: str

    def validate_parameters(self, raw: Mapping[str, object]) -> GeneratorParams: ...
    def generate(
        self,
        rig: RigDefinition,
        params: GeneratorParams,
    ) -> AnimationClip: ...
```

A generator:

- does not modify the rig;
- does not access the GUI;
- does not read arbitrary files;
- produces a validatable clip;
- is deterministic; and
- records effective parameters in `generator_provenance`.

## 12.2 `humanoid_idle_v1`

| Parameter | Default | Recommended range |
|---|---:|---:|
| `duration_ms` | 2000 | 1200 to 4000 |
| `breath_y_px` | 1.5 | 0 to 4 |
| `torso_rotation_deg` | 0.8 | 0 to 3 |
| `head_counter_deg` | 0.5 | 0 to 2 |
| `arm_drift_deg` | 0.7 | 0 to 3 |
| `pelvis_shift_px` | 0.5 | 0 to 2 |

For phase `p = 2πt / duration`:

```text
torso.position_y = -cos(p) × breath_y_px
torso.rotation    =  sin(p) × torso_rotation_deg
head.rotation     = -sin(p) × head_counter_deg
pelvis.position_x =  sin(p) × pelvis_shift_px
upper_arm_l.rot   =  sin(p + π/3) × arm_drift_deg
upper_arm_r.rot   =  sin(p - π/3) × arm_drift_deg
```

The generator converts these curves to keyframes at phases 0, 1/4, 1/2, 3/4, with the loop endpoint implicit.

## 12.3 `humanoid_walk_v1`

| Parameter | Default |
|---|---:|
| `duration_ms` | 800 |
| `step_angle_deg` | 18 |
| `knee_bend_deg` | 12 |
| `arm_swing_deg` | 12 |
| `torso_bob_y_px` | 2.0 |
| `torso_sway_x_px` | 1.0 |
| `pelvis_tilt_deg` | 2.0 |
| `head_counter_deg` | 1.5 |
| `foot_lift_px` | 2.0 |

Conceptual formulas:

```text
phase = 2πt / duration

thigh_l.rot =  sin(phase)       × step_angle
thigh_r.rot =  sin(phase + π)   × step_angle
upper_arm_l =  sin(phase + π)   × arm_swing
upper_arm_r =  sin(phase)       × arm_swing
pelvis.rot  =  sin(phase)       × pelvis_tilt
torso.y     = -abs(sin(phase))  × torso_bob_y
pelvis.x    =  sin(phase)       × torso_sway_x
head.rot    = -sin(phase)       × head_counter
```

Knee bend and foot lift apply primarily during each leg's forward phase. The MVP does not require IK.

Events:

- `foot_contact_l` at 0 ms.
- `foot_contact_r` at `duration_ms / 2`.

## 12.4 `quadruped_idle_v1`

Parameters control chest breathing, a slight head tilt, tail swing, and minimal body displacement. The tail uses delayed phase between `tail_0` and `tail_1`.

## 12.5 `quadruped_walk_v1`

The initial gait is a simplified diagonal walk:

- `front_l` and `hind_r` share phase;
- `front_r` and `hind_l` are opposite;
- chest and hips oscillate with small differences;
- the neck compensates body movement; and
- the tail follows with delay.

The generator is not an exact biomechanics simulation; it MUST read clearly and pleasantly at 12 fps.

## 12.6 `avian_walk_v1`

The first avian walk is an in-place anthropomorphic traveler gait for `avian_v1`. One immutable
pose tuple is built once per render transaction and shared by every root-yaw direction. It MUST:

- close exactly at the loop boundary;
- alternate left and right support contacts;
- bound stance-foot drift in actor space and prevent ground penetration;
- lift the swing foot visibly before the next contact;
- include pelvis weight transfer and torso counter-motion;
- stabilize the head while allowing small readable secondary motion; and
- apply delayed, bounded follow-through to the wing-arms and tail.

AF-057 defines numeric defaults and tolerances from the reviewed geometric-avian and macaw tests.
The motion is reusable only by packages that validate against `avian_v1`.

## 12.7 Variation without losing reuse

Each actor can save a parameter preset. Examples:

- heavy: slower cycle, greater bob, smaller arm swing;
- small: faster cycle, short steps;
- proud: steadier torso, high head; and
- nervous creature: short idle with more active head motion.

This creates identity without drawing every animation again.

---

# 13. Direction derivation and profiles

## 13.1 Layered-2D direction resolution

```python
class DirectionMode(str, Enum):
    AUTHORED = "authored"
    MIRROR = "mirror"
```

Algorithm:

1. If the direction is `authored`, evaluate the rig and render normally.
2. If it is `mirror`, render its source direction.
3. Horizontally mirror the complete RGBA frame around the canvas center axis.
4. Mirror spatial metadata: anchor X, exported sockets, and hitboxes.
5. Preserve semantic event IDs.

## 13.2 Why a legacy layered direction mirrors the final frame

Mirroring each bone, pivot, and asset separately introduces many failure points. When the legacy
layered strategy is selected, mirroring the complete frame is deterministic and visually identical
to its source. This rule does not apply to 3D-derived output.

## 13.3 Direct 3D yaw resolution

Each bounded 3D path builds one immutable motion tuple once per render transaction. For every
sampled pose, it holds the camera fixed and rerenders the actor at `SE=-90`, `SW=180`, `NE=0`, and
`NW=90` degrees of root yaw. Frame indexes, times, durations, events, actor package, geometry,
camera, lighting, and materials remain identical across views. Finished RGBA pixels are never
rotated or mirrored.

The output requires adjacent strict directional-prerender metadata containing one shared motion
SHA-256 and the ordered yaw table. Preview and export consume the same verified frame sequence.
AF-058 applies this rule to the validated macaw actor package without weakening AF-052's fixed
actor contract or accepting arbitrary scenes.

## 13.4 Future overrides

The schema MUST allow `SW` or `NW` to change from `mirror` to `authored` without changing clips. Non-isometric projects MAY later add `S` or `N`.

## 13.5 Direction motion profiles

A `DirectionProfile` MAY declare per-channel multipliers when the same rotation reads differently in `SE` and `NE`:

```json
{
  "track_multipliers": {
    "upper_arm_l.rotation_deg": 0.8,
    "thigh_r.rotation_deg": 0.9
  }
}
```

The first renderer delivery may defer applying this feature, but the model reserves it.

---

# 14. Renderer and compositor

## 14.1 Interface

```python
@dataclass(frozen=True)
class RenderRequest:
    project: Project
    rig: RigDefinition
    clip: AnimationClip | None
    direction: Direction
    time_ms: float
    quality: RenderQuality


class Renderer(Protocol):
    def render(self, request: RenderRequest) -> RenderedFrame: ...
```

`RenderedFrame` contains:

- a `uint8` RGBA buffer;
- canvas size;
- ground anchor;
- resolved sockets;
- active events when requested; and
- clipping diagnostics.

## 14.2 Layered-2D per-frame pipeline

1. Perform lightweight request validation.
2. Resolve the authored source direction.
3. Evaluate tracks at `time_ms`.
4. Build local transforms.
5. Calculate world matrices in topological order.
6. Resolve part and equipment transforms.
7. Sort by slot, `slot_order`, and `z_bias`.
8. Load images through cache.
9. Convert to premultiplied alpha.
10. Apply affine transform to the canvas.
11. Composite using `source over`.
12. Convert back to straight RGBA.
13. Mirror if the requested direction is derived.
14. Detect alpha pixels touching canvas edges.
15. Return frame and metadata.

The 3D prerender pipeline is batch-oriented rather than a call to this 2D compositor: construct one
pose tuple, apply each pose, rerender the actor at each fixed yaw, validate and fingerprint the
complete sequence, and let review and export consume those verified pixels.

## 14.3 Premultiplied alpha

For each pixel:

```text
src_rgb_p = src_rgb × src_a
out_rgb_p = src_rgb_p + dst_rgb_p × (1 - src_a)
out_a     = src_a     + dst_a     × (1 - src_a)
```

At the end:

```text
out_rgb = out_rgb_p / out_a, when out_a > epsilon
```

This prevents dark halos around rotated contours.

## 14.4 Affine transformation

- Use `cv2.warpAffine` with a transparent border.
- Default final quality is `INTER_CUBIC`.
- Compose in `float32`.
- Round and clamp final output to 0..255.
- Preview and export use this same implementation.

## 14.5 Cache

Minimum in-memory cache:

- decoded image by `asset_id + sha256`;
- premultiplied image;
- rig topological order;
- clip evaluation by `(clip_id, time_ms)` while the rig is unchanged; and
- optional complete frame by project revision.

Every mutation increments `project_revision` and invalidates dependent entries.

## 14.6 Clipping

An export is invalid when pixels above the alpha threshold touch an edge and `allow_clipping` is false. The GUI marks the edge and validation emits `AFV501`.

## 14.7 Pixel snapping

Options:

- `none`: preserve subpixel position.
- `integer`: round world translations to an integer pixel before rasterization.

Default is `none`. Users may compare both for their chosen style.

---

# 15. Layer import and optional cutout

## 15.1 Layer importer interface

```python
class LayerImporter(Protocol):
    def inspect(self, source: Path) -> ImportInspection: ...
    def import_layers(self, request: LayerImportRequest) -> ImportResult: ...
```

## 15.2 MVP formats

- Direction-specific folders of PNG files.
- RGBA PNG or indexed transparent PNG convertible to RGBA.
- Optional `layers.manifest.json`.

PSD, Krita, and SVG are future adapters. They MUST NOT distort the architecture: every importer produces `AssetLayer` values.

## 15.3 Import process

1. Enumerate files in stable order.
2. Reject paths outside the selected root.
3. Decode and validate dimensions.
4. Convert to RGBA.
5. Calculate alpha bounding box.
6. Trim if enabled.
7. Copy into the project under a canonical name.
8. Calculate SHA-256.
9. Propose `semantic_part` from filename and aliases.
10. Present mapping for user confirmation.
11. Save the manifest.

## 15.4 Safety limits

Configurable initial limits:

- maximum 2048 × 2048 px per layer;
- maximum 50 MB per file;
- maximum 500 layers per import;
- do not follow symbolic links outside the root; and
- do not persist absolute paths.

## 15.5 Asset linter

| Code | Condition |
|---|---|
| `AFV101` | file not found |
| `AFV102` | unreadable PNG |
| `AFV103` | completely transparent layer |
| `AFV104` | dimensions exceed limit |
| `AFV105` | duplicate semantic part in one direction |
| `AFV106` | missing authored view |
| `AFV107` | layer touches source canvas edge |
| `AFV108` | hash disagrees with manifest |

## 15.6 Later Cut Studio

Cut Studio includes:

- polygon lasso;
- add/remove mask brush;
- split and merge components;
- connected-component suggestions;
- patch duplication and painting; and
- immediate pivot preview.

It operates on derived copies and never writes over source art.

## 15.7 Background-removal contract

The self-contained optional engine is based on the proven Tukevejtso BiRefNet cutout method. “Based on” means intentionally porting the validated preprocessing, model invocation, mask normalization, alpha construction, edge cleanup, and diagnostic behavior into this repository—not depending on Tukevejtso at runtime.

Application contract:

```python
@dataclass(frozen=True)
class BackgroundRemovalRequest:
    source_path: Path
    output_rgba_path: Path
    output_mask_path: Path
    model_id: str
    device_preference: str
    parameters: Mapping[str, JsonValue]


class BackgroundRemovalPort(Protocol):
    def inspect(self) -> BackgroundRemovalCapabilities: ...
    def remove_background(
        self,
        request: BackgroundRemovalRequest,
        cancellation: CancellationToken,
    ) -> OperationResult[BackgroundRemovalArtifact]: ...
```

`BackgroundRemovalArtifact` records:

- source SHA-256;
- output RGBA and mask paths and hashes;
- operation format `animated-fabric.cutout-operation.v1`;
- engine ID and vendored source revision;
- model identifier, immutable revision, and checksum;
- effective parameters;
- device class, without unstable machine-specific details in exported artifacts;
- image dimensions;
- elapsed time in logs, but not deterministic artifact identity; and
- structured diagnostics.

Operational rules:

- The operation is opt-in and visibly identified as automatic background removal.
- The user reviews output before it becomes an imported layer.
- It MUST NOT invent hidden body surfaces or claim to separate overlapping semantic parts.
- Alpha and mask dimensions exactly match the source.
- The source is decoded once and treated read-only.
- Output writes occur in a temporary directory and commit atomically.
- Cancellation removes temporary output and preserves earlier derived artifacts.
- No operation writes outside the project-approved output root.
- Repeating on the same image, model, architecture, and parameters SHOULD produce pixel-identical output; tests use pinned fixtures and tolerance where GPU kernels cannot guarantee byte identity.
- CPU fallback MAY exist. Lack of GPU produces a capability diagnostic, not a failure of the normal application.
- No inference happens in the GUI thread.

## 15.8 Optional engine packaging

The repository owns two dependency planes:

1. **Core plane:** Python 3.12, Qt, Pydantic, Pillow, NumPy, OpenCV, Typer, and Rich.
2. **Cutout plane:** pinned BiRefNet adapter, Torch, torchvision, Transformers as required by the vendored method, CUDA runtime when enabled, and a pinned model artifact.

The cutout plane MUST use a dedicated optional image or stage, for example service `animated-fabric-cutout` behind Compose profile `cutout`. It shares only explicit input/output and model-cache volumes. It exposes no port, receives no Docker socket, and has networking disabled during operation.

The main application MUST report the capability as `unavailable` with actionable instructions when the profile or model cache is absent. This is not a project-validation error for prepared layers.

## 15.9 Provenance and maintenance

Before accepting the vendored engine:

- record the exact source commit and copied files;
- preserve license headers and create a third-party notice;
- record model card, license, revision, and checksum;
- port Tukevejtso's representative cutout fixtures or create equivalent owned fixtures;
- compare edge quality and alpha output against the known-good implementation;
- add CPU/GPU capability checks without making GPU a base requirement; and
- document how to update the engine deliberately rather than silently tracking upstream.

## 15.10 Reviewed 3D actor-package contract

AF-055 defines `animated-fabric.actor-package.v1` as a closed, data-only boundary and proves it
only with the repository-generated `geometric-fixture-v1`. The accepted tree contains exactly the
canonical UTF-8 `actor-package.json`, one `actor.glb`, and one to eight declared files named
`textures/<texture-id>.png`; no other file or empty directory is allowed. The manifest is canonical
JSON with exact keys, two-space indentation, sorted object keys, ASCII escaping, and one final
newline. The actor-package verifier MUST receive the expected manifest SHA-256 from trusted worker
code rather than from the package. AF-055 pins that external trust anchor to
`1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c`.

### 15.10.1 Manifest schema

The manifest has `schema_version: "0.1.0"` and exactly these top-level members:

| Member | Exact AF-055 contract |
|---|---|
| `format` | `animated-fabric.actor-package.v1` |
| `package_id` | Lowercase ASCII identifier, at most 64 characters |
| `actor` | Exact `root_node`, `neutral_pose: "rest"`, and `ground_z_m: 0.0` |
| `asset` | Exact path `actor.glb`, media type `model/gltf-binary`, positive byte count, and lowercase SHA-256 |
| `textures` | One to eight records sorted by path; exact identity-derived path, `image/png`, `RGBA8`, dimensions, bytes, and lowercase SHA-256 |
| `coordinates` | The exact axes, units, handedness, storage convention, and conversion below |
| `limits` | Profile `af055-bounded-core-gltf-v1` and the exact compiled ceiling map below |
| `observed` | Decoded counts, bounds, texture properties, and content sizes; every value MUST equal verifier observations |
| `content_set` | Format `animated-fabric.actor-content-set.v1`, exact ordered content paths, and their framed SHA-256 |
| `provenance` | Exact `geometry_license`, `kind`, `sources`, `texture_license`, and `ticket`; kind is `repository-generated-geometric-fixture` or `reviewed-authored-actor`, ticket is `AF-NNN`, licenses are bounded SPDX identifiers, and one to 32 source records are unique and sorted by lowercase ID with canonical safe relative path and SHA-256 |

The content-set order is `actor.glb` followed by the sorted texture paths. Its digest is SHA-256
over the ASCII format line and, for every record in that order, path, NUL, lowercase file hash,
NUL, decimal byte count, and newline. The manifest, content-set, GLB, texture, and neutral-render
identities for the reviewed proof are respectively:

- `1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c`;
- `a84df998d86644671bcbde1f1723132fd1f2b3fac8288ed28debac8f9cb245c4`;
- `e3079588a75b9553609ee41939119cd00b119e750706e29426eafc472f2bafa3`;
- `fd6abcd872a1f4ada38e541352dfac74452597072fc5fea5d9ad5450a01e94e6`;
  and
- `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`.

These identities approve only the geometric validator fixture. They do not identify or approve a
macaw actor.

### 15.10.2 Coordinates and bounded GLB subset

Actor space is right-handed, uses meters, and fixes `+X` right, `+Y` forward, `+Z` up, with the
neutral ground plane at actor `Z=0`. GLB storage is glTF 2.0 right-handed Y-up; storage axes map as
`+X -> +X`, `+Y -> +Z`, and `+Z -> -Y`. The one scene MUST expose one identity-transform actor
root whose unique name matches `actor.root_node`. Every node MUST belong to that acyclic,
singly-parented tree; mesh nodes MUST already be in actor coordinates.

The GLB has exactly one JSON chunk followed by one embedded BIN chunk and exactly the root members
`accessors`, `asset`, `bufferViews`, `buffers`, `images`, `materials`, `meshes`, `nodes`, `samplers`,
`scene`, `scenes`, `skins`, and `textures`. Extensions and extras are forbidden at every depth. The
accepted geometry is indexed triangles with tightly packed, unstrided accessors and only
`POSITION`, `NORMAL`, `TEXCOORD_0`, plus paired `JOINTS_0` and `WEIGHTS_0` for skinned primitives.
Positions, normals, UVs, weights, matrices, transforms, and declared bounds MUST be finite. Local
node rest transforms and every composed world matrix remain within the compiled coordinate bound,
node scales are nonzero, and each mesh's composed world transform is identity because its vertices
are already in actor coordinates. Normals are unit length, UVs and material factors remain in
`[0, 1]`, weights are normalized, and every mathematically positive influence addresses the
declared skin and counts toward the influence ceiling. Every node, mesh, material, texture, image,
sampler, accessor, buffer view, and declared skin MUST be reachable and used by the actor; hidden
or unused data is rejected.

Images are external only in the narrow sense that the GLB URI names a manifest-declared package
PNG. URI escapes, schemes, percent/query/fragment syntax, data URIs, and undeclared files are
forbidden. PNGs MUST contain only one `IHDR`, contiguous `IDAT`, and one `IEND`; each is
non-interlaced RGBA8 with valid CRCs and decoded size. Materials are the bounded metallic-roughness
base-color subset with `OPAQUE` or `MASK` alpha, one explicit fixed linear-mipmapped-repeat sampler
per texture, and `TEXCOORD_0`. One optional skin is accepted; it has an in-tree skeleton, one to 64
unique descendant joints, finite invertible FLOAT `MAT4` inverse-bind matrices, and at most four
normalized influences per vertex. Every inverse-bind matrix is finite, invertible, within the
coordinate bound, and when multiplied by its joint's composed rest transform yields identity.
This validates the AF-055 fixture skin but does not define the `avian_v1` hierarchy or approve its
deformation.

### 15.10.3 Compiled ceilings

The manifest MUST repeat this complete policy map exactly; lower self-declared limits do not
replace the compiled verifier policy.

| Resource | Maximum |
|---|---:|
| Package files / total bytes | 10 / 33,554,432 |
| Manifest bytes | 262,144 |
| GLB bytes / GLB JSON bytes / embedded buffer bytes | 25,165,824 / 1,048,576 / 25,165,824 |
| Textures / bytes each | 8 / 4,194,304 |
| Texture dimension / pixels each / pixels total | 2,048 px / 4,194,304 / 16,777,216 |
| Nodes / meshes / primitives | 128 / 16 / 32 |
| Accessors / buffer views | 256 / 256 |
| Vertices / indices / triangles | 100,000 / 600,000 / 200,000 |
| Materials / skins / joints / influences per vertex | 16 / 1 / 64 / 4 |
| Absolute actor coordinate | 10.0 m |

### 15.10.4 Filesystem, worker, and evidence boundary

Package paths are canonical ASCII, relative, forward-slash paths without aliases, traversal, drive
syntax, absolute paths, case collisions, trailing-dot segments, portable device basenames, or
unsupported names. The only directory is the nonempty root `textures/`; enumeration stops at the
compiled entry ceiling. The verifier accepts only singly linked regular files and real directories;
symbolic links, hard links, junctions, reparse points, device-like entries, and linked ancestors
are rejected. It reads without following links, copies bounded bytes to a private snapshot, seals
directories and files read-only, validates only that snapshot, rechecks its closed tree and hashes
after use, and rejects a source tree that changes during the copy. The isolated Linux worker MUST
also prove `/actor-package` is a read-only mount and its runtime namespace has only loopback before
preflight.

Only after the complete preflight may the fixed baked Blender worker import `actor.glb`. A second
gate MUST reject imported actions, drivers, NLA, constraints, linked libraries, cameras, lights,
speakers, packed or unexpected images, unsupported objects or modifiers, topology/count drift,
joint or weight drift, noncanonical armature-modifier settings, nonfinite evaluated geometry,
deformed-bound drift, and lost ground contact. The package cannot choose worker code, render
settings, camera, light, motion, output path, or container configuration. The fixed worker then
renders only the 192 x 192 transparent rest-pose validation frame and atomically publishes a closed
`neutral.png` plus `validation.json` evidence tree bound to the package and every executed local
worker-source hash. The neutral PNG is at most 1,048,576 bytes and contains only CRC-valid `IHDR`,
contiguous `IDAT`, and empty `IEND`; the canonical validation report is at most 262,144 bytes.

The package MUST NOT contain or reference `.blend` files, Python, drivers, expressions, add-ons,
external references, embedded animation, cameras, lights, audio, unsupported extensions, or
undeclared behavior. AF-053 remains frozen and continues to use its separate procedural worker and
input-free contract. AF-056 authors and validates the first rights-cleared macaw package and defines
the reviewed `avian_v1` hierarchy, bone mapping, bind pose, weights, and deformation review within
this isolated plane. General or untrusted 3D import requires a later decision. Mesh deformation
never becomes a dependency or behavior of layered-2D projects.

---

# 16. Desktop GUI

## 16.1 Technology

- PySide6.
- `QMainWindow` as the shell.
- `QGraphicsView` and `QGraphicsScene` for rig and canvas.
- `QUndoStack` for reversible commands.
- `QThreadPool` for rendering, import, export, and optional cutout orchestration.
- `QTimer` for playback and debounce.

## 16.2 Workspaces

### A. Project

- create/open project;
- choose template;
- configure canvas and directions; and
- inspect project health.

### B. Layers

- asset list and thumbnails;
- semantic mapping;
- visibility;
- nondestructive reimport; and
- optional background-removal action with before/after review when available.

### C. Rig

- bones and pivots;
- bindings;
- sockets;
- draw slots; and
- authored-direction selector.

### D. Animation

- selected clip;
- generator and parameters;
- timeline scrubber;
- play, pause, and loop;
- track and keyframe table; and
- regenerate as an undoable operation.

### E. Export

- profile;
- animations;
- directions;
- fps;
- sheet preview; and
- validation and export.

## 16.3 Suggested layout

```text
┌───────────────────────────────────────────────────────────────┐
│ menu and toolbar                                              │
├──────────────┬──────────────────────────────┬─────────────────┤
│ project tree │ canvas                       │ inspector       │
│ parts/bones  │ zoom, pan, overlays          │ properties      │
├──────────────┴──────────────────────────────┴─────────────────┤
│ timeline / scrubber / playback / diagnostics                 │
└───────────────────────────────────────────────────────────────┘
```

## 16.4 Canvas interaction

- wheel: zoom around cursor;
- middle button or Space + drag: pan;
- click: select;
- drag pivot: move pivot;
- drag bone: move rest transform;
- `Shift`: constrain axis;
- `Alt`: fine adjustment; and
- overlays: bones, pivots, anchor, boundaries, and optional onion frame.

## 16.5 Undo and commands

Every GUI mutation is a command, including:

- `MoveBoneCommand`;
- `MovePivotCommand`;
- `AssignPartCommand`;
- `ChangeDrawSlotCommand`;
- `SetGeneratorParameterCommand`; and
- `RegenerateClipCommand`.

A command holds previous and next state, an English description, and updates project revision.

## 16.6 Responsiveness

- No operation expected to exceed 50 ms runs deliberately on the GUI thread.
- Parameter changes are grouped with 50 to 100 ms debounce.
- Preview may skip frames if rendering falls behind; it MUST NOT build an unbounded queue.
- Export and optional cutout support cancellation at safe boundaries.

## 16.7 Dirty state and recovery

The title bar indicates unsaved changes. If a newer autosave exists, the GUI offers recovery or discard. Recovery creates a backup before replacement.

## 16.8 Minimum first GUI

The first GUI prioritizes:

1. open project;
2. import layers;
3. view and move bones and pivots;
4. apply a preset;
5. play preview; and
6. export.

A complete curve editor and integrated cutout UI are not MVP requirements.

---

# 17. CLI and application API

## 17.1 Executables

- `animated-fabric`: CLI.
- `animated-fabric-gui`: GUI.
- `python -m animated_fabric`: CLI alias.

## 17.2 Commands

```bash
animated-fabric new ./eva_mage \
  --template humanoid_v1 \
  --canvas 192x192

animated-fabric import-layers ./eva_mage \
  --direction SE \
  --source ./art/eva/SE

animated-fabric rig apply-template ./eva_mage

animated-fabric animation generate ./eva_mage \
  --generator humanoid_idle_v1 \
  --clip idle

animated-fabric animation generate ./eva_mage \
  --generator humanoid_walk_v1 \
  --clip walk \
  --set duration_ms=800 \
  --set step_angle_deg=18

animated-fabric validate ./eva_mage

animated-fabric render-frame ./eva_mage \
  --clip walk --direction SE --time-ms 200 \
  --out ./preview.png

animated-fabric export ./eva_mage \
  --profile default_grid \
  --out ./build/eva_mage
```

Optional future cutout command, available only with the cutout profile:

```bash
animated-fabric cutout ./eva_mage/source/original/composite.png \
  --project ./eva_mage \
  --out-name composite_foreground
```

The command MUST fail with an actionable capability diagnostic when the optional engine is unavailable; it MUST NOT install dependencies or download a model automatically.

## 17.3 Diagnostic output

Default output is human-readable English. `--json` returns a structured array:

```json
[
  {
    "code": "AFV203",
    "severity": "error",
    "message": "Part 'hand_r' references missing bone 'wrist_r'.",
    "path": "rig/main.animated-rig.json",
    "location": "parts[8].bone_id",
    "suggestion": "Use 'hand_r' or create the required bone."
  }
]
```

## 17.4 Exit codes

| Code | Meaning |
|---:|---|
| 0 | success |
| 2 | validation errors |
| 3 | input or import failure |
| 4 | render failure |
| 5 | export failure |
| 6 | optional capability unavailable or cutout failure |
| 10 | unexpected internal failure |

## 17.5 Use-case classes

CLI and GUI call the same use cases:

```python
CreateProject
OpenProject
ImportLayerSet
ApplyRigTemplate
UpdateRigElement
GenerateAnimation
ValidateProject
RenderFrame
ExportProject
RemoveImageBackground
```

Each use case receives a typed request and returns a typed result with diagnostics. It neither prints nor shows windows. `RemoveImageBackground` is registered only when an adapter is configured and does not belong to normal validation or rendering.

---

# 18. Export

## 18.1 Default profile

```json
{
  "profile_id": "default_grid",
  "format": "animated-fabric.grid-spritesheet.v1",
  "animations": ["idle", "walk"],
  "directions": ["SE", "SW", "NE", "NW"],
  "fps": 12,
  "trim_frames": false,
  "include_json": true,
  "allow_clipping": false,
  "include_generated_at": false
}
```

## 18.2 Grid spritesheet

The MVP produces one PNG per animation.

- width = `frame_width × frame_count`;
- height = `frame_height × direction_count`;
- columns are increasing time;
- rows follow profile direction order;
- every cell retains a fixed canvas; and
- background is transparent.

```text
walk.png
row 0: SE frame 0 ... frame N
row 1: SW frame 0 ... frame N
row 2: NE frame 0 ... frame N
row 3: NW frame 0 ... frame N
```

## 18.3 `animated-fabric.grid-spritesheet.v1` metadata

```json
{
  "format": "animated-fabric.grid-spritesheet.v1",
  "project": "eva_mage",
  "animation": "walk",
  "image": "walk.png",
  "frame_size": [192, 192],
  "origin": [96.0, 160.0],
  "fps": 12,
  "duration_ms": 800,
  "directions": ["SE", "SW", "NE", "NW"],
  "frames_per_direction": 10,
  "frames": [
    {
      "direction": "SE",
      "index": 0,
      "rect": [0, 0, 192, 192],
      "duration_ms": 80,
      "events": ["foot_contact_l"]
    }
  ]
}
```

## 18.4 Frame export

```text
exports/eva_mage/walk/SE/000.png
exports/eva_mage/walk/SE/001.png
...
```

It includes `animation.json` using the same metadata model.

## 18.5 Export transaction

- Render into a temporary directory.
- Verify all expected files exist and decode successfully.
- Write JSON last.
- Atomically replace the destination where possible.
- On cancellation or error, remove temporary output and preserve the previous export.

## 18.6 Engine adapters

Outside the MVP, but the interface permits:

```python
class EngineExporter(Protocol):
    exporter_id: str

    def export(
        self,
        package: RenderPackage,
        destination: Path,
    ) -> ExportResult: ...
```

The first recommended adapter is Godot 4, without making Godot a core dependency.

---

# 19. Quality, testing, and performance

## 19.1 Development tools

Core development dependencies:

- `pytest`;
- `pytest-cov`;
- `pytest-qt`;
- `ruff`;
- `mypy`; and
- `hypothesis` for mathematics and validators when useful.

Container and supply-chain verification SHOULD include:

- Docker BuildKit/Buildx;
- Compose v2 configuration validation;
- an SBOM generator;
- dependency vulnerability scanning; and
- license inventory.

These tools run inside CI or controlled Linux tooling images, not through a host Python installation.

## 19.2 Mandatory quality gate

Before closing any ticket, run inside the authoritative Linux development container:

```bash
ruff format --check .
ruff check .
mypy src
pytest -q
```

The preferred host invocation is:

```bash
docker compose run --rm animated-fabric-dev \
  sh -lc 'ruff format --check . && ruff check . && mypy src && pytest -q'
```

Codex MUST report actual command results. It MUST NOT claim a check passed without running it in the project container.

## 19.3 Coverage

- At least 85% in `domain`, `application`, `animation`, and `render`.
- GUI code need not meet the same percentage, but controllers and commands are tested.
- Core code is not excluded from coverage without an explanation.
- Optional cutout orchestration, validation, and postprocessing are tested independently of downloading or running the large model.

## 19.4 Unit tests

Minimum coverage includes:

- ID and path validation;
- bone cycle detection;
- stable topological ordering;
- matrix composition;
- interpolation;
- temporal looping;
- generator periodicity;
- slot resolution;
- directional-prerender metadata and motion fingerprints;
- legacy layered metadata mirroring when that path is implemented;
- premultiplied alpha;
- exact duration distribution;
- JSON save and round trip;
- background-removal job validation and atomic output; and
- proof that normal imports do not require optional ML dependencies.

## 19.5 Owned visual fixtures

The repository generates geometric test art with no third-party rights:

- `stick_humanoid`: RGBA circles and rectangles as layers;
- `block_quadruped`: simple polygons as layers;
- equipment: geometric hat and sword; and
- cutout inputs: owned geometric foregrounds over known backgrounds, including soft edges and interior holes.

These fixtures exercise the complete pipeline without final art or external downloads.

## 19.6 Golden-image tests

Core cases:

- neutral `SE` pose;
- neutral `NE` pose;
- direct-yaw `SE`, `SW`, `NE`, and `NW` at one common 3D motion phase;
- walk at one-quarter cycle;
- equipment composition; and
- rotated transparency without a halo.

Suggested comparison:

- maximum per-channel difference <= 2;
- pixels outside tolerance <= 0.1%; and
- exact dimensions and alpha structure.

Optional cutout golden tests compare pinned owned fixtures against reviewed masks. CPU and GPU baselines MAY be distinct when documented numeric behavior differs. Updating a golden requires a written visual reason.

## 19.7 Integration tests

Core flow:

1. Create a temporary project.
2. Generate layered fixtures.
3. Import `SE` and `NE`.
4. Apply a template.
5. Generate `idle` and `walk`.
6. Validate.
7. Export.
8. Decode PNG and JSON output.
9. Verify frames, events, dimensions, hashes, and paths.

Optional cutout flow:

1. Inspect engine capability.
2. Submit an owned source image read-only.
3. Produce mask, RGBA, and operation record under a temporary destination.
4. Verify hashes, dimensions, alpha, and provenance.
5. Repeat and compare according to the declared determinism policy.
6. Cancel a job and verify no partial artifact survives.
7. Disable the optional profile and verify the core test suite still passes.

## 19.8 Performance targets

These are targets, not permission for premature optimization:

- 192 × 192 preview with 40 parts at a sustained 12 fps on a common development machine;
- no deliberate GUI stalls above 50 ms;
- export 4 directions × 12 frames × 40 parts in a few seconds;
- typical core project memory below 500 MB; and
- cutout latency measured separately, with no core-memory target polluted by the ML process.

Profile first, optimize second.

## 19.9 CI

The authoritative CI job runs on Linux and MUST:

1. validate Compose configuration;
2. build the same development image used locally;
3. install no project dependency on the runner host;
4. run formatting, lint, type check, and tests in that image;
5. run the end-to-end demo;
6. verify CLI help, `doctor`, fixture generation, and package installability;
7. build the release image or wheel in Linux when packaging begins; and
8. publish the sample spritesheet and relevant reports as CI artifacts.

For AF-053, the public visual sample is limited to `walk.png`, `walk_contact_sheet.png`, and
`walk_review.gif`, accompanied by the scoped CC0 notice. Product/evidence JSON and repository source
remain `AGPL-3.0-only`. Raw directional frames are not selected for CI publication, and publishing
generated pixels does not approve the Blender container image for redistribution.

A Windows Python 3.12 CI lane MAY remain for future native distribution compatibility. If enabled, it is an additional check and does not authorize host-side development. GUI tests use `QT_QPA_PLATFORM=offscreen` where applicable.

The optional cutout image has its own scheduled or manually triggered CI lane because model size and GPU availability MUST NOT slow or destabilize every core change. Lightweight adapter tests remain in core CI.

---

# 20. Errors, logging, and security

## 20.1 Typed exceptions

- `ProjectValidationError`
- `ProjectVersionError`
- `AssetImportError`
- `RigDefinitionError`
- `AnimationError`
- `RenderError`
- `ExportError`
- `BackgroundRemovalError`
- `OptionalCapabilityUnavailableError`

Exceptions cross internal boundaries only when a use case cannot continue. Expected problems become `Diagnostic` values.

## 20.2 Logging

- Use standard-library `logging`.
- Human-readable logs are the default.
- JSON logs are available for CI.
- Do not log image buffers, secrets, personal data, or unrelated paths.
- Every long operation has an `operation_id`.
- Deterministic artifacts MUST NOT contain unstable timestamps, hostnames, container IDs, absolute paths, or elapsed time.

## 20.3 No runtime network

The core and cutout engine perform no runtime network calls. Any future cloud integration is an explicit extra, disabled by default, isolated behind a protocol, and outside this specification.

Dependency and model retrieval may occur only in an explicit build or cache-seeding workflow using pinned identities and checksum verification. A running application MUST NOT silently fetch code or weights.

## 20.4 Filesystem protection

- Resolve paths against the approved project root.
- Reject traversal.
- Validate extensions and file signatures.
- Enforce size and count limits.
- Write temporaries inside the project or an approved safe directory.
- Never load Python, native libraries, or scripts from a user project.
- Mount source input read-only when crossing a container boundary.
- Do not mount the Docker socket.
- Do not publish project source or workspaces through Caatuu's public static routes.

## 20.5 Privacy and telemetry

The MVP has no telemetry. Crash reports, if added, remain local and user-reviewable. Background-removal inputs and outputs never leave the local machine by default.

## 20.6 Supply-chain requirements

Before a public release:

- pin base images by digest;
- lock Python dependencies with hashes per supported architecture;
- produce SBOMs for core and optional cutout images separately;
- scan dependencies and images;
- document all licenses, especially Qt, OpenCV, BiRefNet code, model weights, Torch, and CUDA components;
- sign release artifacts where the chosen distribution supports signing; and
- document a deliberate update and rollback procedure.

---

# 21. Repository and infrastructure

## 21.1 Repository location and ownership boundary

Animated Fabric lives at:

```text
caatuu/apps/animated-fabric/
```

It is contained by the Caatuu repository but owns its application boundary:

- independent `pyproject.toml`;
- independent `Dockerfile` and `compose.yaml`;
- unique Compose project, image, container, volume, and cache names;
- no dependency on Caatuu runtime routes or web-server code;
- no source mount under public `/demos`; and
- intentionally exported demo artifacts only, if a Caatuu showcase is added later.

## 21.2 Canonical repository tree

```text
apps/animated-fabric/
├── AGENTS.md
├── README.md
├── pyproject.toml
├── Dockerfile
├── compose.yaml
├── constraints/
│   ├── core-linux.lock
│   └── cutout-linux.lock
├── containers/
│   └── cutout/
│       ├── Dockerfile
│       └── README.md
├── docs/
│   ├── SPEC.md
│   ├── STATUS.md
│   ├── LEGAL_INVENTORY.md
│   ├── architecture/
│   ├── decisions/
│   └── third-party/
├── src/
│   └── animated_fabric/
│       ├── __init__.py
│       ├── __main__.py
│       ├── domain/
│       │   ├── assets.py
│       │   ├── animation.py
│       │   ├── diagnostics.py
│       │   ├── geometry.py
│       │   ├── project.py
│       │   └── rig.py
│       ├── application/
│       │   ├── ports.py
│       │   ├── project_service.py
│       │   ├── import_service.py
│       │   ├── rig_service.py
│       │   ├── animation_service.py
│       │   ├── render_service.py
│       │   ├── export_service.py
│       │   ├── validation_service.py
│       │   └── background_removal_service.py
│       ├── infrastructure/
│       │   ├── persistence/
│       │   │   ├── json_project_repository.py
│       │   │   └── migrations.py
│       │   ├── imaging/
│       │   │   ├── image_store.py
│       │   │   ├── alpha.py
│       │   │   └── opencv_renderer.py
│       │   ├── importers/
│       │   │   └── layer_folder_importer.py
│       │   ├── background_removal/
│       │   │   ├── job_contract.py
│       │   │   ├── adapter.py
│       │   │   └── birefnet/
│       │   └── exporters/
│       │       ├── frame_exporter.py
│       │       └── grid_spritesheet_exporter.py
│       ├── templates/
│       │   ├── registry.py
│       │   └── resources/
│       │       ├── humanoid_v1.json
│       │       └── quadruped_v1.json
│       ├── generators/
│       │   ├── registry.py
│       │   ├── humanoid_idle_v1.py
│       │   ├── humanoid_walk_v1.py
│       │   ├── quadruped_idle_v1.py
│       │   └── quadruped_walk_v1.py
│       ├── cli/
│       │   └── app.py
│       └── gui/
│           ├── app.py
│           ├── main_window.py
│           ├── controllers/
│           ├── commands/
│           ├── widgets/
│           └── resources/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── golden/
│   └── fixtures/
└── scripts/
    ├── generate_fixture_assets.py
    └── run_demo_pipeline.py
```

The optional cutout implementation MAY remain absent until M9. Its declared directory does not authorize a stub that pretends the capability exists.

## 21.3 Core runtime dependencies

Baseline:

```toml
requires-python = ">=3.12"

dependencies = [
  "pydantic>=2,<3",
  "numpy>=1.26,<3",
  "opencv-python-headless>=4.9,<5",
  "Pillow>=10,<13",
  "PySide6>=6.7,<7",
  "typer>=0.12,<1",
  "rich>=13,<15",
  "platformdirs>=4,<5"
]
```

These ranges communicate compatibility, not current-version claims. The release process resolves and locks exact versions and hashes in Linux. Major-version changes require a recorded decision.

## 21.4 Optional cutout dependencies

The optional cutout plane MAY include, according to the proven vendored implementation:

- PyTorch;
- torchvision;
- Transformers and associated image-processing dependencies;
- BiRefNet adapter code;
- safetensors or equivalent pinned model format;
- optional CUDA runtime and NVIDIA container support; and
- model artifacts with immutable revision, checksum, and license record.

Exact packages and versions MUST be derived from a verified port of the Tukevejtso method and locked separately. They MUST NOT be guessed in the core `pyproject.toml` or installed into `animated-fabric-dev` merely because future M9 work is planned.

## 21.5 Container contract

Core service `animated-fabric-dev`:

- Linux base with Python 3.12;
- project virtual environment inside the image or dedicated container path;
- non-root runtime user;
- repository mounted at `/workspace` for development;
- no published ports;
- no GPU requirement;
- runtime `network_mode: none` or equivalent;
- only project-scoped cache volumes; and
- deterministic locale and timezone where output can depend on them.

Optional service `animated-fabric-cutout`:

- enabled only with Compose profile `cutout`;
- separate image and dependency lock;
- non-root process where compatible with the device runtime;
- optional NVIDIA GPU reservation, never a core requirement;
- explicit read-only input and writable derived-output mounts;
- persistent model cache owned by Animated Fabric;
- no port, Docker socket, or runtime network; and
- resource limits and cancellation behavior documented before GUI integration.

Neither service uses the generic Caatuu runtime container as its Python environment.

## 21.6 Code rules

- Public APIs have type hints.
- Persisted data uses strict Pydantic models.
- Filesystem code uses `pathlib.Path`.
- `Any` requires a nearby justification.
- Do not catch `Exception` except at CLI, GUI, or worker process boundaries, where it is logged and translated.
- Do not use mutable global state.
- Do not import PySide6 outside `gui`.
- Do not perform IO in domain models.
- Protocols, services, and non-obvious algorithms have docstrings.
- Comments explain reasons rather than restating code.
- ML implementation types do not leak through `BackgroundRemovalPort`.

## 21.7 Project status

`docs/STATUS.md` is updated after each ticket with:

- completed ticket;
- primary files;
- actual checks run inside the container;
- known debt;
- environment or image identity; and
- next permitted ticket.

---

# 22. Milestone implementation plan

Codex MUST NOT implement all milestones in one run. Every milestone ends in an executable and tested vertical slice. Historical `AF-*` ticket IDs remain stable across the English naming and repository migration.

## Milestone M0: repository foundations

### AF-001 Bootstrap

Deliverables:

- `pyproject.toml`;
- installable `animated_fabric` package;
- `animated-fabric --help` and `version`;
- `python -m animated_fabric --help`;
- minimal `animated-fabric-gui` window titled “Animated Fabric”;
- Ruff, mypy, pytest, and coverage configuration;
- independent Linux `Dockerfile` and `compose.yaml` under `apps/animated-fabric`;
- authoritative Linux CI plus optional Windows portability lane;
- `README.md`, `AGENTS.md`, and `docs/STATUS.md`; and
- no host-side project dependency installation.

Acceptance:

```bash
docker compose build animated-fabric-dev
docker compose run --rm animated-fabric-dev python -m pip check
docker compose run --rm animated-fabric-dev python -m animated_fabric --help
docker compose run --rm animated-fabric-dev animated-fabric version
docker compose run --rm animated-fabric-dev ruff check .
docker compose run --rm animated-fabric-dev mypy src
docker compose run --rm animated-fabric-dev pytest -q
```

### AF-002 Diagnostics and errors

- `Diagnostic`, `Severity`, and `OperationResult` models;
- typed base exceptions;
- human-readable English and JSON CLI output; and
- tests.

### AF-003 Geometric fixtures

- script generating `SE` and `NE` layered humanoid sets;
- no external asset dependency; and
- stable hashes and dimensions.

**M0 output:** a healthy, independently containerized repository application and asset demo, still without a rig, renderer, importer, animation, or ML implementation.

## Milestone M1: domain and persistence

### AF-010 Fundamental models

- geometry;
- project manifest;
- assets;
- rig;
- animation; and
- export profile.

### AF-011 JSON repository

- load/save;
- relative paths;
- atomic writes;
- round trip; and
- incompatible-schema rejection.

### AF-012 Validation engine

- structural validators;
- codes `AFV1xx` through `AFV4xx`; and
- CLI `validate`.

**M1 output:** a project can be created, saved, opened, and validated.

## Milestone M2: mathematics and vertical renderer

### AF-020 Transforms

- 3×3 matrices;
- topological tree order;
- pose resolver; and
- composition tests.

### AF-021 Animation evaluator

- tracks;
- interpolation;
- looping; and
- delta evaluation.

### AF-022 OpenCV compositor

- asset cache;
- premultiplied alpha;
- affine warp;
- draw slots; and
- clipping detection.

### AF-023 Golden render

- render fixture neutral pose;
- golden tests; and
- CLI `render-frame`.

**M2 output:** the core produces a correct PNG without the GUI.

## Milestone M3: importer and humanoid rig

### AF-030 Folder importer

- inspect/import;
- trim and `trim_origin`;
- aliases;
- hashes; and
- limits.

### AF-031 Template registry

- JSON resource loader;
- validation; and
- `humanoid_v1`.

### AF-032 Template application

- create bones;
- map parts;
- bindings;
- sockets; and
- `SE`/`NE` profiles.

### AF-033 Rig editing as use cases

- move bone;
- move pivot;
- assign part;
- change slot; and
- command-level undo tests when the GUI exists.

**M3 output:** a fixture is imported and rigged through the CLI.

## Milestone M4: humanoid generators

### AF-040 Interpolation and clip builder

- safe builder;
- key normalization; and
- events.

### AF-041 `humanoid_idle_v1`

- parameters;
- deterministic clip;
- periodicity; and
- golden frames.

### AF-042 `humanoid_walk_v1`

- parameters;
- keyframes;
- foot events; and
- golden frames at 0, 1/4, and 1/2.

### AF-043 Animation CLI

- list generators;
- display parameter schema;
- generate/replace clip; and
- validation.

### AF-044 Experimental Blender prerender feasibility

This is a non-gating research ticket and does not reopen M4 or delay M5.

- create one repository-owned procedural 3D humanoid without external assets;
- create one deterministic in-place walk;
- render direct `SE`, `SW`, `NE`, and `NW` review sequences in an isolated, headless, offline
  Blender container;
- record pinned tool provenance, settings, hashes, repeatability, direct-versus-mirrored
  comparisons, security, licensing, runtime, and output size;
- MAY emit untracked experimental frames using AF-050-compatible sampling and folder conventions;
  and
- add no core dependency, project schema, public CLI or GUI behavior, product renderer, or final
  export path.

Acceptance requires two clean reproducibility runs, structural validation of every RGBA output, a
clear go/revise/stop report, and an unchanged normal Linux quality gate without Blender. AF-044 did
not itself replace ADR-001, ADR-002, or ADR-004. AF-052 and decision 0012 subsequently promote only
the fixed owned actor/walk sequence while preserving the layered OpenCV path.

**M4 output:** the humanoid walks and idles through the complete CLI pipeline.

## Milestone M5: export

### AF-050 Frame exporter

- temporary transaction;
- folder structure; and
- metadata.

### AF-051 Grid spritesheet

- rows by direction;
- columns by frame;
- exact duration; and
- JSON v1.

### AF-052 Directional yaw prerender

- build one canonical walk tuple once and reuse it for `SE`, `SW`, `NE`, and `NW`;
- change only actor-root yaw and rerender, never transform finished 2D frames;
- strict motion fingerprint, direction/yaw metadata, provenance, and source verification;
- package the verified 48-frame sequence through the shared AF-051 grid packer; and
- direct-view golden tests plus native-Linux repeatability evidence.

### AF-053 End-to-end demo

The Linux-host command is:

```bash
bash scripts/run_blender_directional_demo.sh
```

It MUST:

- validate the Blender Compose profile and build both `animated-fabric-dev` and
  `animated-fabric-blender` by default; `--skip-build` MAY reuse images that were built deliberately;
- reject a root host identity or unsafe workspace link, verify that the Blender worker is non-root,
  and apply the five-minute render timeout;
- render the approved fixed actor and canonical `walk` into the exact evidence root
  `workspaces/blender/af053-demo`;
- verify the exact evidence layout, hashes, metadata, reviewed goldens, alpha bounds, and
  direct-view-versus-mirror thresholds;
- create human review media in the sibling `workspaces/blender/af053-demo-review` and atomically
  package the product in the sibling `workspaces/blender/af053-product`;
- leave the evidence root immutable and exact, with review and product files outside it; and
- report SHA-256 values for the two evidence reports, two product files, and two review files.

The evidence root contains exactly `walk/`, `directional-prerender.json`, and `provenance.json` at
its top level. The product root contains exactly `walk.png` and `walk.spritesheet.json`; the review
root contains exactly `walk_contact_sheet.png` and `walk_review.gif`. Repeating the command in the
same pinned native-Linux environment MUST replace stale derived outputs and produce identical
evidence, product, and review trees.

This is host-side orchestration, not application orchestration. The host shell may invoke Docker
Compose, but product Python MUST NOT invoke Docker, mount its socket, import `bpy`, or combine the
Blender and development dependency planes. The script accepts no actor, scene, motion, project,
destination, or renderer override. General layered-project orchestration remains a separate path
and MUST NOT be fabricated through the 3D adapter.

Native Linux CI MUST exercise the command from scratch, repeat it, compare all three output trees,
and publish only the cleared sample media and reports described in Section 19.9. AF-053 is accepted
only after that authoritative native run passes. AF-060 was next at AF-053 acceptance; decision
0014 subsequently inserts the user-directed AF-054 through AF-059 vertical slice before it.

**M5 output:** the first usable product without the GUI.

## Milestone M5A: reviewed macaw actor bridge

M5 remains complete. M5A is the user-directed real-character vertical slice that adds a production
candidate after the fixed proof actor without changing that accepted implementation or turning the
worker into a general 3D importer. AF-060 is deferred until M5A closes.

### AF-054 Reviewed macaw reference package

- preserve the original identity, side-walk, and prepared-parts sources without modification;
- create one versioned reference manifest with exact hashes and provenance;
- produce individually hashed `front`, `left`, `back`, and `right` modeling references at a common
  canvas, scale, and ground line, with left/right defined by image-space beak direction;
- record exact crop rectangles for any combined review sheet;
- identify every inferred or generated view as a candidate rather than recovered geometry;
- record the selected `anthropomorphic_traveler` gait; and
- require a separate approval record bound to the exact manifest and ordered view-set digests before
  AF-056 may consume the package;
- publish the accepted package only under `assets/reference-packages/macaw-traveler-v1/`; and
- update both the root and application legal inventories before accepted source art or derivatives
  are tracked or published.

AF-054 may use the self-contained cutout plane only as optional preprocessing. It does not claim
semantic separation, hidden-surface recovery, a 3D model, rig, animation, or final render.

### AF-055 Validated 3D actor package

- define strict `animated-fabric.actor-package.v1` JSON;
- prove one bounded data-only GLB plus declared textures with a repository-generated geometric
  fixture, without authoring or accepting the macaw yet;
- validate exact files, hashes, axes, units, root, geometry, materials, textures, joints, and
  resource limits before load;
- reject executable or scene-level behavior, external references, embedded animation, symlinks,
  hardlinks, reparse points, traversal, absolute paths, and unsupported URIs;
  and
- produce a deterministic neutral validation render in the isolated Blender worker.

### AF-056 `avian_v1` rig and skinned macaw

- publish the stable avian hierarchy and explicit actor-package bone mapping;
- perform the human-reviewed modeling and material-authoring step from the approved references;
- create the first rights-cleared macaw package with mesh, materials, armature, weights, and bind
  pose;
- enforce finite normalized weights, bounded influences, valid joints, and ground contact; and
- review neutral, limb-extreme, tail, and wing deformation poses.

No generic automatic modeling or rigging is implied.

### AF-057 `avian_walk_v1`

- build one deterministic in-place anthropomorphic traveler walk once;
- prove exact loop closure, alternating contacts, bounded stance-foot drift, swing clearance, and
  no ground penetration;
- include readable weight transfer, head stabilization, and controlled tail/wing follow-through;
  and
- validate the same motion on a geometric avian fixture and the approved macaw.

### AF-058 Actor-package directional yaw prerender

- extend the bounded worker only to `animated-fabric.actor-package.v1`;
- reuse one immutable pose tuple and fingerprint at `SE=-90`, `SW=180`, `NE=0`, and `NW=90`;
- keep camera, timing, geometry, materials, textures, and lighting common across directions;
- never transform finished RGBA frames; and
- feed the verified sequence to the unchanged AF-051 grid packer.

### AF-059 Macaw end-to-end demo

- provide one fixed native-Linux command starting from the pre-authored validated actor package and
  its approved reference provenance, then run the avian walk, four direct views, review media,
  spritesheet, and JSON;
- run twice from clean state and prove repeatable evidence, review, and product trees;
- require no clipping, visible skin collapse, ground penetration, or unacceptable foot sliding;
- obtain explicit visual approval; and
- publish only named, rights-cleared sample artifacts.

**M5A output:** the real traveler macaw walks in four direct yaw-rendered directions from one motion.

## Milestone M6: functional GUI

### AF-060 Shell and document state

- create/open;
- dirty state;
- autosave;
- recovery; and
- diagnostics panel.

### AF-061 Layer and canvas view

- thumbnails;
- visibility;
- zoom/pan; and
- selection.

### AF-062 Rig editor

- draggable bones and pivots;
- inspector;
- `QUndoStack`; and
- `SE`/`NE` profiles.

### AF-063 Animation preview

- scrubber;
- playback;
- generator parameters;
- worker; and
- cancellation.

### AF-064 Export wizard

- profile;
- validation;
- progress;
- cancellation; and
- open destination.

**M6 output:** a nontechnical user completes the primary flow.

## Milestone M7: sockets and equipment

### AF-070 Equipment catalog

- asset sets by direction;
- socket;
- draw slot; and
- variant.

### AF-071 Equipment preview and export

- hat;
- weapon;
- shield; and
- persisted loadout.

### AF-072 Combination golden demo

- 2 hats;
- 2 weapons; and
- the same rig and clips.

**M7 output:** proof that appearance combinations scale without duplicating animation.

## Milestone M8: quadrupeds

### AF-080 `quadruped_v1`

- template;
- aliases;
- draw slots; and
- geometric fixture.

### AF-081 Idle/walk generators

- diagonal gait;
- tail;
- neck; and
- golden tests.

### AF-082 GUI and export

- the same flow as humanoids; and
- no separate editor.

**M8 output:** a complete second anatomical family.

## Milestone M9: Cut Studio and optional professional cutout

M9 starts only after the stable M0–M8 flow. Planning and dependency isolation may be documented earlier, but the heavy engine MUST NOT leak into earlier runtime requirements.

### AF-090 Mask editor

- mask visualization;
- add/remove brush; and
- nondestructive history.

### AF-091 Connected components

- analysis;
- selection; and
- owned-fixture tests.

### AF-092 Split/merge/extract

- derived layer operations; and
- atomic output.

### AF-093 Hidden-surface patches

- explicit user-created patches;
- provenance; and
- no claim of automatic recovery.

### AF-094 Background-removal protocol

- `BackgroundRemovalPort`;
- request/result models;
- capability diagnostics;
- cancellation;
- operation provenance; and
- adapter-independent tests.

### AF-095 Vendored BiRefNet cutout engine

- inventory the proven Tukevejtso implementation and exact source revision;
- copy the necessary method into Animated Fabric with preserved attribution;
- build the separate optional Linux cutout image/profile;
- pin model and dependencies by revision and checksum;
- reproduce known-good foreground and alpha quality on owned fixtures;
- add offline CPU/GPU doctor checks;
- integrate the CLI and reviewed GUI workflow; and
- prove core install, test, import, render, and export remain independent.

**M9 output:** optional professional cutout and manual refinement, fully owned by this repository and never required for prepared layers.

---

# 23. End-to-end acceptance cases

## E2E-001 Basic owned 3D humanoid

Given the repository-owned procedural 3D humanoid and its canonical `walk`, when the isolated worker
renders and the verified packer exports it through
`bash scripts/run_blender_directional_demo.sh` from a clean bounded workspace:

- validation contains no errors;
- the evidence, product, and review roots are exactly `workspaces/blender/af053-demo`,
  `workspaces/blender/af053-product`, and `workspaces/blender/af053-demo-review`;
- `SE`, `SW`, `NE`, and `NW` are direct actor-root yaw views of the same pose tuple;
- `SW` is materially different from a horizontal mirror of `SE`;
- `NW` is materially different from a horizontal mirror of `NE`;
- `walk` has PNG and JSON output;
- the sheet is 2,304 x 768 with twelve 192 x 192 cells per row;
- foot events appear in `walk`; and
- a repeated complete command produces the same evidence, product, and review results without stale
  files.

The layered-2D humanoid remains covered by its import, rig, animation, authored-direction render,
and explicit-direction export tests. AF-052 does not invent 3D data for that project format.

## E2E-002 Reusable equipment

Given that humanoid with two hats and two weapons:

- rig and clips do not change;
- every combination exports;
- equipment follows sockets;
- visual order is correct; and
- every direction strategy retains coherent combinations without a silent renderer switch.

## E2E-003 Quadruped

Given the quadruped fixture:

- `quadruped_v1` applies;
- `idle` and `walk` generate;
- there are no orphan parts;
- tail and head move; and
- four directions export.

## E2E-004 Corrupt project

Given a cyclic rig or missing asset:

- `validate` returns code 2;
- the diagnostic identifies field and remedy;
- export refuses without deleting the previous export; and
- the GUI does not freeze.

## E2E-005 Cancellation

During a long export:

- the user can cancel;
- temporary output is removed;
- the project remains valid; and
- previous export remains intact.

## E2E-006 Optional background removal

Given an owned composite fixture and an available pinned cutout profile:

- source is unchanged;
- RGBA, mask, and operation JSON are created under `derived/cutouts`;
- output dimensions match input;
- provenance and hashes are complete;
- the user may reject output without importing it;
- cancellation leaves no partial output;
- runtime network remains disabled; and
- the same project still imports prepared PNG layers when the cutout service is absent.

## E2E-007 Reviewed traveler macaw

Given the approved traveler-macaw reference package, validated actor package, `avian_v1` mapping,
and one canonical `avian_walk_v1`, when the AF-059 native-Linux command runs twice from clean state:

- all source and derived identities match their declared hashes and provenance;
- the actor validates without executable or external package content;
- neutral and deformation review poses contain no visible skin collapse;
- the walk closes, alternates contacts, clears swing feet, and has acceptable planted-foot drift;
- `SE`, `SW`, `NE`, and `NW` are direct root-yaw renders of the same pose tuple;
- every direction retains the approved identity, materials, anchor, scale, and timing;
- review GIF, contact sheet, spritesheet, and JSON pass structural and visual review; and
- the repeated evidence, review, and product trees match under the recorded native environment.

---

# 24. Codex execution protocol

## 24.1 Primary rule

Codex works on one ticket or an explicitly requested small ticket group. It MUST NOT implement future phases on its own initiative.

All productive work runs through the project's Linux container. The host filesystem may be inspected and patched, but host or Codex-bundled runtimes MUST NOT install dependencies, generate assets, format code, execute tests, package releases, or produce other authoritative artifacts.

## 24.2 Before writing code

Codex MUST:

1. read the nearest `AGENTS.md`, `docs/SPEC.md`, and `docs/STATUS.md`;
2. identify the active ticket;
3. list affected contracts;
4. note material ambiguity;
5. use documented defaults before requesting a new decision;
6. inspect `Dockerfile` and `compose.yaml` before executing project tools; and
7. confirm commands target `apps/animated-fabric`, not an old demo copy or a host environment.

## 24.3 During implementation

- Add tests with code.
- Maintain an executable vertical slice.
- Do not add stubs that imply nonexistent behavior.
- Do not add dependencies without justification and correct dependency-plane placement.
- Do not silently change normative schemas.
- Do not duplicate logic between GUI and CLI.
- Do not use third-party art.
- Do not execute productive project commands through host Python or Codex workspace dependencies.
- Keep conceptual changes small when the environment permits.
- Preserve unrelated user changes in the Caatuu worktree.

## 24.4 Before declaring completion

Run in the Linux container and report:

```bash
ruff format --check .
ruff check .
mypy src
pytest -q
```

If the ticket affects rendering or export:

```bash
python scripts/run_demo_pipeline.py --out .tmp/demo
```

Inspect dimensions, output files, hashes, and diagnostics. For visual tickets, show or describe the updated golden and do not replace it without explaining the change.

If the ticket affects container or optional cutout infrastructure, also validate:

```bash
docker compose config --quiet
docker compose build <affected-service>
```

Then test from the newly built image, not only a stale running container. Verify runtime network, mounts, user identity, ports, and device assumptions according to the service contract.

## 24.5 Final response for each ticket

Required format:

```text
Ticket completed: AF-XXX

Changes:
- ...

Checks run:
- command: actual result

Decisions or deviations:
- none / details

Remaining risks:
- ...

Next permitted ticket:
- AF-YYY
```

## 24.6 Prohibitions

Codex MUST NOT:

- claim to have executed commands it did not run;
- hide relevant warnings;
- replace the renderer with a Qt renderer;
- introduce networking or AI into core dependencies;
- merge source and derived assets;
- couple models to widgets;
- invent untested format support;
- expand scope merely to make a task “more complete”;
- install project dependencies on Windows;
- use a Codex-provided runtime for productive artifacts;
- require Tukevejtso at build time or runtime;
- download model weights when the application starts; or
- mount the Docker socket into an application service.

---

# 25. Recommended initial Codex prompt

Use this text from the Caatuu repository with the working directory set to `apps/animated-fabric`:

```text
We are starting Animated Fabric.

Read AGENTS.md, docs/SPEC.md, and docs/STATUS.md first. The specification is normative. Do not build the complete application in this task.

Implement only Milestone M0, tickets AF-001, AF-002, and AF-003.

Objectives:
1. Create an installable Python 3.12 package named animated_fabric.
2. Add pyproject.toml with the specified core and development dependencies.
3. Create a Typer CLI with `version` and `doctor`, plus `python -m animated_fabric --help`.
4. Create a minimal PySide6 GUI titled “Animated Fabric”, with no domain behavior.
5. Implement Diagnostic, Severity, and OperationResult with tests.
6. Create typed base exceptions.
7. Create scripts/generate_fixture_assets.py producing deterministic geometric SE and NE humanoid PNG layers without external assets.
8. Configure Ruff, mypy, pytest, coverage, Linux-authoritative CI, and the optional Windows portability lane.
9. Create an independent Linux Dockerfile and compose.yaml for apps/animated-fabric.
10. Create README.md and update docs/STATUS.md when complete.

Restrictions:
- Do not implement rig models, the renderer, a real importer, animation, Cut Studio, or BiRefNet yet.
- Do not use runtime networking.
- Do not add a database.
- Do not import PySide6 outside src/animated_fabric/gui.
- English is required for code, identifiers, documentation, CLI, GUI, diagnostics, and tests.
- Add tests for every non-trivial behavior.
- Do not install or run project dependencies on Windows or through a Codex-bundled runtime.
- Run all productive commands in the Animated Fabric Linux container.
- Do not depend on Tukevejtso; only document the future self-contained optional cutout boundary.

Before modifying files, summarize the plan and contracts in fewer than 12 lines. Then implement.

At completion, run in the project container:
ruff format --check .
ruff check .
mypy src
pytest -q
python scripts/generate_fixture_assets.py --out .tmp/fixtures
python -m animated_fabric doctor

Report actual results, primary files, and any deviation. Do not start M1.
```

---

# 26. Definition of done for version 0.1

Stable version 0.1 requires:

- M0 through M8 complete, including the user-directed M5A macaw vertical slice;
- GUI completes the core flow without the CLI;
- CLI completes the same flow without the GUI;
- humanoid and quadruped support;
- `idle` and `walk`;
- four logical directions;
- sockets and basic equipment;
- deterministic export;
- autosave recovery;
- clear validation;
- minimum user documentation;
- green authoritative Linux container CI;
- the declared Windows compatibility lane green if Windows distribution is promised;
- no third-party asset with uncertain license; and
- no known crash on the happy path.

M9 and professional background removal are not required for 0.1 unless the release explicitly advertises that capability. If advertised, AF-090 through AF-095 and the separate cutout supply-chain checks become required.

A feature that is “almost done” does not count. It must be visible, tested, and reachable through a use case.

---

# 27. Risks and defenses

| Risk | Probability | Impact | Defense |
|---|---:|---:|---|
| incomplete art at joints | high | high | art contract, overlap, validation |
| mismatch between `SE` and `NE` | high | high | shared anchors, comparison overlay |
| rigid or robotic rig | medium | medium | gentle parameters, torso/head compensation |
| incorrect equipment draw order | high | high | draw slots and golden tests |
| scope creep into a professional editor | high | high | milestones, no advanced timeline in MVP |
| unreliable automatic cutout | high | high | optional reviewed derived output; never primary workflow |
| heavy ML stack contaminates core | high | high | separate image, lock, cache, and profile |
| upstream Tukevejtso drift | medium | medium | vendored revision and deliberate update procedure |
| model or code license ambiguity | medium | high | attribution and license gate before integration |
| preview differs from export | medium | high | one verified rendering authority per source path |
| jitter from variable canvas | medium | high | fixed canvas and anchor |
| halos on rotated edges | medium | medium | premultiplied alpha |
| schema changes break projects | medium | high | versioning, migrations, backups |
| GUI blocked by export or cutout | medium | high | workers, cancellation, debounce |
| real art required for testing | high | medium | generated geometric fixtures |
| host/container inconsistency | high | high | Linux container is authoritative |
| Caatuu unintentionally publishes source | medium | high | application under `apps`, explicit public-artifact boundary |
| bounded 3D prerender expands into unsafe arbitrary execution | medium | high | fixed actor or strict data-only package, no executable input, decisions 0012 and 0014 |
| Blender output differs across CPU hosts | medium | medium | native reference artifacts and decoded-pixel golden tolerance |
| demo orchestration collapses container trust boundaries | medium | high | Linux host owns Compose; Blender renders; dev validates and packages; product Python has no Docker or `bpy` access |
| CI publishes uncleared generated or container material | medium | high | exact artifact allowlist, scoped CC0 notice for three visual files, AGPL for JSON/source, Blender image remains internal-only |
| one-view macaw art is mistaken for complete 3D truth | high | high | four-view candidate, explicit inference labels, human approval before actor construction |
| actor-package parsing expands the input attack surface | medium | high | rights-cleared bounded GLB, exact hashes and limits, regular files only, read-only mount, no executable or external input |
| avian skin collapses or feet slide | medium | high | reviewed extreme poses, normalized bounded weights, contact and drift tests, visual acceptance |
| generated turnaround drifts from the approved identity | medium | high | immutable source hashes, side-by-side review, candidate status until explicit approval |

---

# 28. Deferred decisions with current defaults

| Topic | Default | Review point |
|---|---|---|
| game engine | generic export | after M5 |
| first engine adapter | Godot 4 recommended | after engine selection |
| repository license | `AGPL-3.0-only` | recorded at the repository root |
| final canvas | 192 × 192 | first real-art test |
| animation fps | 12 | after visual-style evaluation |
| extra views | 4 direct yaws for the owned 3D actor; layered declarations unchanged | after M8 |
| PSD/Krita | unsupported | after stable PNG importer |
| mesh deformation | only approved `avian_v1` skinning inside the isolated 3D prerender plane; none in layered 2D | after AF-059 |
| background removal | optional vendored BiRefNet plane | M9, never before core stability |
| cutout device | GPU when available, explicit CPU fallback if validated | AF-095 |
| cutout IPC | job directory/CLI | review during GUI integration |
| Windows release | not promised by Linux development baseline | packaging milestone |
| Blender/3D prerender | fixed humanoid proof plus one reviewed data-only macaw actor package; container remains internal | after AF-059 demo |

These defaults do not authorize work beyond the active ticket; decision 0014 governs the narrow
M5A exceptions.

---

# 29. Glossary

- **Actor:** an animatable character or creature.
- **Actor package:** a bounded, hashed, data-only 3D input accepted by the isolated prerender worker.
- **Asset layer:** a PNG image representing one visual piece.
- **Authored direction:** a direction backed by directly created art.
- **Background removal:** optional foreground-mask estimation that creates reviewed derived artifacts.
- **Binding:** relationship between a visual part and a bone.
- **Bone:** a hierarchical transform node.
- **Canvas:** fixed area of each frame.
- **Clip:** a collection of tracks, keyframes, and events.
- **Core plane:** normal application dependencies, excluding the ML cutout stack.
- **Cutout plane:** separately packaged optional BiRefNet dependency and model environment.
- **Derived asset:** a generated or normalized file.
- **Direction profile:** rig and draw adjustments for an orientation.
- **Directional prerender:** a verified RGBA sequence produced by rendering one 3D motion at fixed
  actor-root yaws.
- **Direct-yaw direction:** a logical direction rendered from 3D by changing actor-root yaw while
  preserving the camera, motion, timing, materials, and lighting.
- **Draw slot:** semantic category used to order layers.
- **Generator:** deterministic function producing an explicit clip.
- **Ground anchor:** canvas point representing ground contact.
- **Part:** a rigged visual element.
- **Pivot:** local point in an image around which it transforms.
- **Prepared layer:** a transparent, complete visual part ready for normal import.
- **Rig:** bones, bindings, sockets, and direction profiles.
- **Skin:** bounded vertex-to-bone weights used only by an approved actor inside the isolated 3D plane.
- **Socket:** attachment point for equipment or accessories.
- **Source asset:** original art, immutable after import.
- **Turnaround:** approved front, left, back, and right reference views at common scale and ground line.
- **Vendored method:** source and behavior copied into this repository at a recorded revision, not imported from a sibling checkout.

---

# Appendix A. Complete reduced rig example

```json
{
  "format": "animated-fabric.rig.v1",
  "schema_version": "0.1.0",
  "rig_id": "main",
  "template_id": "humanoid_v1",
  "bones": [
    {
      "bone_id": "root",
      "parent_id": null,
      "rest_transform": {
        "position": [96.0, 160.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      }
    },
    {
      "bone_id": "pelvis",
      "parent_id": "root",
      "rest_transform": {
        "position": [0.0, -24.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      }
    },
    {
      "bone_id": "torso",
      "parent_id": "pelvis",
      "rest_transform": {
        "position": [0.0, -24.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      }
    },
    {
      "bone_id": "head",
      "parent_id": "torso",
      "rest_transform": {
        "position": [0.0, -30.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      }
    }
  ],
  "parts": [
    {
      "part_id": "body_torso",
      "semantic_part": "torso",
      "bone_id": "torso",
      "assets_by_direction": {
        "SE": "SE_torso",
        "NE": "NE_torso"
      },
      "pivot_by_direction": {
        "SE": [24.0, 40.0],
        "NE": [24.0, 40.0]
      },
      "bind_transform": {
        "position": [0.0, 0.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      },
      "draw_slot": "torso",
      "slot_order": 0,
      "visible": true,
      "opacity": 1.0
    }
  ],
  "sockets": [
    {
      "socket_id": "head_hat",
      "bone_id": "head",
      "local_transform": {
        "position": [0.0, -22.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0]
      },
      "default_draw_slot": "hair_front"
    }
  ],
  "draw_slot_profiles": {
    "SE": [
      "ground_shadow",
      "cape_back",
      "leg_far",
      "leg_near",
      "torso",
      "arm_far",
      "head",
      "hair_front",
      "arm_near",
      "weapon_front"
    ],
    "NE": [
      "ground_shadow",
      "weapon_back",
      "arm_far",
      "head_back",
      "head",
      "torso",
      "cape_back",
      "arm_near",
      "leg_far",
      "leg_near"
    ]
  }
}
```

# Appendix B. Reduced clip example

```json
{
  "format": "animated-fabric.animation-clip.v1",
  "schema_version": "0.1.0",
  "clip_id": "idle",
  "display_name": "Idle",
  "template_id": "humanoid_v1",
  "duration_ms": 2000,
  "loop": true,
  "fps_hint": 12,
  "tracks": [
    {
      "target_type": "bone",
      "target_id": "torso",
      "property": "position_y",
      "value_mode": "delta",
      "keys": [
        {"time_ms": 0, "value": -1.5, "interpolation": "smooth"},
        {"time_ms": 1000, "value": 1.5, "interpolation": "smooth"}
      ]
    },
    {
      "target_type": "bone",
      "target_id": "head",
      "property": "rotation_deg",
      "value_mode": "delta",
      "keys": [
        {"time_ms": 0, "value": 0.0, "interpolation": "smooth"},
        {"time_ms": 500, "value": -0.5, "interpolation": "smooth"},
        {"time_ms": 1500, "value": 0.5, "interpolation": "smooth"}
      ]
    }
  ],
  "events": [],
  "generator_provenance": {
    "generator_id": "humanoid_idle_v1",
    "parameters": {
      "duration_ms": 2000,
      "breath_y_px": 1.5
    }
  }
}
```

# Appendix C. Python protocol contracts

```python
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Protocol


class ProjectRepository(Protocol):
    def load(self, root: Path) -> Project: ...
    def save(self, root: Path, project: Project) -> None: ...


class AssetStore(Protocol):
    def load_rgba(self, project_root: Path, asset: AssetLayer) -> RgbaImage: ...
    def invalidate(self, asset_id: str) -> None: ...


class RigTemplateRegistry(Protocol):
    def list_templates(self) -> Sequence[RigTemplateSummary]: ...
    def get(self, template_id: str) -> RigTemplate: ...


class AnimationGeneratorRegistry(Protocol):
    def list_generators(self, template_id: str) -> Sequence[GeneratorSummary]: ...
    def generate(
        self,
        generator_id: str,
        rig: RigDefinition,
        parameters: Mapping[str, object],
    ) -> AnimationClip: ...


class Renderer(Protocol):
    def render(self, request: RenderRequest) -> RenderedFrame: ...


class ProjectExporter(Protocol):
    exporter_id: str

    def export(self, request: ExportRequest) -> ExportResult: ...


class BackgroundRemovalPort(Protocol):
    def inspect(self) -> BackgroundRemovalCapabilities: ...
    def remove_background(
        self,
        request: BackgroundRemovalRequest,
        cancellation: CancellationToken,
    ) -> OperationResult[BackgroundRemovalArtifact]: ...
```

# Appendix D. New-layer review checklist

- [ ] PNG has genuine transparency.
- [ ] No residual colored background remains.
- [ ] The part is complete beneath overlap regions.
- [ ] The pivot can sit within a hidden region.
- [ ] Scale matches the other authored view.
- [ ] Ground anchor matches the project.
- [ ] The layer does not touch the edge.
- [ ] Filename maps to a semantic part.
- [ ] The contour has no halo from the original background.
- [ ] Interchangeable equipment is separate.
- [ ] Ground shadow is separate.
- [ ] The corresponding element exists in `SE` and `NE` when visible in both.
- [ ] If created by cutout, the user reviewed the mask and operation provenance.
- [ ] Cutout output is not mistaken for reconstruction of hidden surfaces.

# Appendix E. Initial diagnostic list

| Code | Severity | Summary |
|---|---|---|
| `AFC010` | error | unexpected CLI boundary failure |
| `AFD001` | error | unsupported Python runtime |
| `AFD002` | error | required runtime dependency unavailable |
| `AFV001` | error | manifest missing |
| `AFV002` | error | incompatible schema |
| `AFV003` | error | path outside project |
| `AFV004` | error | invalid referenced project document |
| `AFV101` | error | asset missing |
| `AFV102` | error | PNG unreadable |
| `AFV103` | warning | transparent layer |
| `AFV104` | error | dimensions exceeded |
| `AFV105` | error | duplicate part |
| `AFV106` | error | authored direction missing |
| `AFV107` | warning | art touches edge |
| `AFV108` | warning | hash changed |
| `AFV109` | error | duplicate asset ID |
| `AFV201` | error | bone cycle |
| `AFV202` | error | missing parent |
| `AFV203` | error | binding references missing bone |
| `AFV204` | warning | part without binding |
| `AFV205` | error | multiple roots |
| `AFV206` | warning | pivot far outside asset |
| `AFV207` | error | duplicate rig element ID |
| `AFV208` | error | socket references missing bone |
| `AFV301` | error | track target missing |
| `AFV302` | error | key outside duration |
| `AFV303` | error | duplicate key |
| `AFV304` | warning | clip has no tracks |
| `AFV305` | warning | event outside range |
| `AFV306` | error | keyframes unordered |
| `AFV307` | error | invalid animation track channel or value |
| `AFV401` | error | unknown draw slot |
| `AFV402` | error | visible part has no order |
| `AFV403` | warning | unused socket |
| `AFV404` | error | duplicate draw slot |
| `AFV501` | error | clipped frame |
| `AFV502` | error | invalid export profile |
| `AFV503` | error | destination not writable |
| `AFV601` | info | optional cutout capability unavailable |
| `AFV602` | error | cutout model revision or checksum mismatch |
| `AFV603` | error | cutout output escaped approved root |
| `AFV604` | warning | requested cutout device unavailable; fallback selected |
| `AFV605` | error | cutout output dimensions mismatch |
| `AFV606` | warning | automatic mask requires user review |

---

## Closing statement

Animated Fabric will not win through the raw volume of illustrations. It will win by turning a small
amount of carefully prepared appearance and one reusable motion into a living, repeatable,
extensible system. Its first 3D-path victory is one owned actor that traverses the pipeline without
direction-specific animation tricks: one motion, four actor-root yaws, verified frames, export,
and proof. The layered-2D path remains available for art that benefits from direct illustration.

Professional cutout is valuable when source art needs it, but it remains a tool at the edge of that pipeline: local, reviewed, self-contained, and isolated. From the first proven actor onward, each new creature becomes less of a mountain and more of a recipe.
