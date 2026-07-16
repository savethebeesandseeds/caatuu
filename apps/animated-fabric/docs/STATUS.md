# Animated Fabric status

**Target version:** 0.1.0

**Current state:** Milestones M0 and M1 complete; M2 in progress (AF-020 through AF-022 complete)

**Last updated:** 2026-07-16

## Completed work

M0 - repository foundations.

- [x] AF-001 Bootstrap
- [x] AF-002 Diagnostics and errors
- [x] AF-003 Geometric fixtures

M1 - domain and persistence.

- [x] AF-010 Fundamental models
- [x] AF-011 JSON repository
- [x] AF-012 Validation engine

M2 - mathematics and vertical renderer (in progress).

- [x] AF-020 Transforms
- [x] AF-021 Animation evaluator
- [x] AF-022 OpenCV compositor
- [ ] AF-023 Golden render

## Delivered scope

- Installable `animated_fabric` package for Python 3.12.
- Typer CLI named `animated-fabric` with `version`, `doctor`, `validate`, module execution,
  and human-readable or JSON diagnostics.
- Minimal PySide6 GUI titled "Animated Fabric".
- Strict `Diagnostic`, `Severity`, and `OperationResult` contracts and typed exceptions.
- Deterministic generator for 28 RGBA PNG layers across `SE` and `NE` directions.
- Dedicated `caatuu-animated-fabric-dev` Linux container, running as a non-root user with
  no ports and no runtime network.
- Linux-primary CI and container-based quality gates.
- A self-contained, optional background-removal tool isolated from the base application
  runtime under `tools/cutout`.
- Strict, frozen Pydantic contracts for geometry, project manifests, assets, rigs,
  animation clips, direction profiles, and export profiles.
- Normative array-shaped geometry serialization, safe project-relative paths, UUID v4
  project IDs, schema/format identifiers, semantic IDs, SHA-256 values, and local numeric
  ranges.
- Public domain exports and 103 AF-010 model tests covering normative JSON round trips,
  strictness, default isolation, and the deliberate AF-012 validation boundary.
- An application-owned `ProjectRepository` port and Linux filesystem adapter for canonical
  manifest, rig, and animation JSON documents.
- Deterministic UTF-8 JSON with sorted maps, preserved list order, 2-space indentation, and
  one final newline; stable `0.1.x` compatibility checks and exact format discrimination.
- Atomic sibling-temporary writes using file flush, `fsync`, and `os.replace`, with cleanup
  and preservation of the prior file when publication fails.
- Lexical and resolved-path containment, symlink-escape rejection, immutable `source/`
  enforcement, structured repository failure categories, and 39 AF-011 integration tests.
- Pure, deterministic project, asset, rig, animation, and draw-order validators with stable
  `AFV1xx` through `AFV4xx` diagnostics, globally sorted output, and no IO in the domain.
- Application-owned `ValidateProject` orchestration that loads canonical project documents
  through the repository port and maps expected repository failures to actionable diagnostics.
- Structural checks for authored/mirrored directions, observed PNG state, bone graphs,
  bindings, pivots, animation targets and keys, draw slots, and explicitly supplied socket use.
- CLI validation returns 0 for a healthy or warning-only project, 2 for validation errors, and
  10 for an unexpected boundary failure; focused unit and integration coverage exercises each
  public behavior and repository-error mapping.
- Immutable, finite 3x3 affine matrices with column-vector translation, visually clockwise
  rotation in the y-down canvas, scale, deterministic multiplication, and normative `T * R * S`
  composition without adding a non-Pydantic dependency to the domain.
- Stable parent-before-child bone ordering that uses declaration index as its deterministic
  ready-node priority and rejects empty, duplicate, missing-parent, invalid-root, and cyclic rigs
  with `RigDefinitionError`.
- Direction-aware pose resolution for bone world matrices, visual-part bind and pivot matrices,
  and socket matrices, including explicit animation deltas and immutable resolved results.
- Pure clip-time normalization with looping modulo, non-looping clamp, first/last-key hold,
  exact-key preservation, and earlier-key `step`, `linear`, or smoothstep interpolation.
- Rig-aware animation evaluation that produces immutable, pose-compatible bone deltas and final
  part visibility, opacity, and integer z-bias without introducing renderer dependencies.
- Absolute bone channels resolve against the selected direction rest pose; delta channels apply
  direction-profile multipliers, with scale multipliers acting around multiplicative identity.
- Runtime evaluation rejects duplicate or incompatible channels, invalid inactive keys,
  out-of-duration keys, and non-finite arithmetic through typed `AnimationError` failures.
- Image-library-neutral planning resolves authored-direction asset overrides, animation part
  state, direction slots, additive z-bias, and stable `(slot, effective order, part_id)` order.
- Integer pixel snapping rounds the controlling bone's world translation before recomposing the
  normative bind and pivot matrix; subpixel transforms remain untouched by the default mode.
- A bounded LRU asset cache safely resolves project-local PNG paths, rejects symlink escapes,
  enforces file/dimension limits and SHA-256/trim metadata, and retains strongly read-only decoded
  RGBA plus premultiplied revisions keyed by `(asset_id, sha256)`.
- Indexed or RGBA PNG input converts to true RGBA without channel swapping. Missing optional
  assets contribute no pixels; missing required, corrupt, mismatched, or unsafe assets fail with
  typed `RenderError` exceptions.
- The OpenCV compositor uses forward float32 2x3 affine matrices, transparent borders, cubic
  sampling by default, premultiplied source-over, guarded unpremultiplication, and deterministic
  straight `uint8` RGBA bytes.
- Final-frame clipping reports top/right/bottom/left alpha contact against a configurable
  threshold without prematurely applying export policy.
- A hand-authored 4 x 3 owned golden locks exact channel order, affine placement, alpha blend,
  dimensions, and clipping behavior while AF-023 retains the full neutral-pose golden renderer.

The cutout engine was brought forward as an explicit infrastructure request. This does
not complete M9 or AF-095: cutout application ports, reviewed importer/GUI integration, owned
golden-quality acceptance, and the project-owned CUDA image verification remain future
work.

Principal files:

- `pyproject.toml`, `README.md`, `Dockerfile`, and `compose.yaml`
- `src/animated_fabric/cli/app.py`
- `src/animated_fabric/domain/diagnostics.py`
- `src/animated_fabric/domain/exceptions.py`
- `src/animated_fabric/domain/_base.py`
- `src/animated_fabric/domain/geometry.py`
- `src/animated_fabric/domain/transforms.py`
- `src/animated_fabric/domain/hierarchy.py`
- `src/animated_fabric/domain/pose.py`
- `src/animated_fabric/domain/interpolation.py`
- `src/animated_fabric/domain/animation_evaluator.py`
- `src/animated_fabric/domain/project.py`
- `src/animated_fabric/domain/assets.py`
- `src/animated_fabric/domain/rig.py`
- `src/animated_fabric/domain/animation.py`
- `src/animated_fabric/domain/export.py`
- `src/animated_fabric/application/ports.py`
- `src/animated_fabric/application/rendering.py`
- `src/animated_fabric/application/validation_service.py`
- `src/animated_fabric/domain/validation/`
- `src/animated_fabric/infrastructure/persistence/json_project_repository.py`
- `src/animated_fabric/infrastructure/imaging/alpha.py`
- `src/animated_fabric/infrastructure/imaging/image_store.py`
- `src/animated_fabric/infrastructure/imaging/opencv_compositor.py`
- `src/animated_fabric/gui/app.py`
- `scripts/generate_fixture_assets.py`
- `scripts/generate_af022_compositor_golden.py`
- `tools/cutout/`
- `Dockerfile.cutout`, `requirements-cutout-*.txt`, and `docs/CUTOUT.md`
- `tests/unit/`
- `tests/unit/test_transform_matrices.py`
- `tests/unit/test_bone_hierarchy.py`
- `tests/unit/test_pose_resolution.py`
- `tests/unit/test_animation_interpolation.py`
- `tests/unit/test_animation_evaluator.py`
- `tests/unit/test_render_planning.py`
- `tests/unit/test_premultiplied_alpha.py`
- `tests/unit/test_image_asset_cache.py`
- `tests/unit/test_opencv_compositor.py`
- `tests/golden/af022_compositor.png`
- `tests/integration/test_json_project_repository.py`
- `tests/integration/test_validate_cli.py`
- `tests/cutout/`
- `.github/workflows/animated-fabric-ci.yml` at the Caatuu repository root

## Verification

Executed on 2026-07-16 through the repository-owned Linux container after AF-022:

- `ruff format --check .`: 82 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 40 source files.
- `pytest -q`: 396 passed; 94.89% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- `python scripts/generate_fixture_assets.py --out .tmp/fixtures`: deterministic fixture
  generated successfully.
- CLI module help and `doctor`: passed in English; doctor reported no problems.
- CLI `validate`: healthy, warning-only, schema, path, missing-document, and structural-error
  scenarios passed in integration tests; a process-level missing-project smoke emitted `AFV001`
  JSON and exited 2.
- `python scripts/generate_af022_compositor_golden.py --out .tmp/af022_compositor.png`:
  passed; `cmp` matched the committed golden and both SHA-256 values were
  `a094760e3f53a72b89a9a4e075215f544f6f0b61a5acc961e169f892f8eea56c`.
- `python scripts/run_demo_pipeline.py --out .tmp/demo`: not runnable because the script does
  not exist at AF-022. The narrow compositor is complete, but the full fixture renderer and demo
  pipeline remain AF-023 work.

Infrastructure and cutout checks retained from the preceding M0/M1 verification on the same
date:

- `docker compose config --quiet` and the complete profile configuration: passed.
- `docker compose build animated-fabric-dev`: passed from the digest-pinned Python 3.12
  Bookworm base.
- GUI offscreen construction: passed and reported window title `Animated Fabric`.
- baked-image smoke without a checkout mount, writable root, ports, or network: passed.
- `cutout-core` image build and classic image/alpha/mask/diagnostic/preview smoke: passed;
  output was 192 x 192 RGBA with alpha range 0 through 255.
- `cutout-cpu` image build: passed; all optional ML modules reported available.
- explicit model provisioning: pinned BiRefNet revision downloaded into the project-owned
  volume and all four committed SHA-256 values verified.
- offline CPU BiRefNet inference: passed with read-only input/model mounts and no network;
  output was 192 x 192 RGBA with alpha range 0 through 255 and recorded the pinned revision.
- public checks for the former demo source paths returned HTTP 404.

## Known debt and risks

- The CI workflow must still be exercised by GitHub after these files are committed.
- The dedicated CUDA image target is defined but was not built in this run. The adapted
  provider passed an offline CUDA smoke against the already validated Tukevejtso dependency
  environment; this does not replace building and scanning Animated Fabric's own CUDA image.
- M0 uses exact version constraints but not hash-locked Python wheels or a Debian snapshot.
  Hash locks, SBOMs, image scanning, and generated dependency notices remain release gates.
- Animated Fabric first-party code has no approved repository or component license yet;
  the retained MIT notices apply only to the identified upstream cutout materials.
- Qt runs offscreen in automated tests; interactive GUI display from Linux requires host display
  forwarding.
- M0 fixtures are intentionally geometric; no production artwork is bundled.
- No full renderer orchestration, importer, complete-frame mirroring, or export execution exists
  at AF-022. `CompositeRequest` and `CompositedFrame` are deliberately narrow so they do not
  impersonate the specification's later `RenderRequest` and metadata-rich `RenderedFrame`.
- Domain matrices deliberately use immutable Python floats because the normative dependency rule
  permits only the standard library and Pydantic in `domain`. AF-022 converts to contiguous NumPy
  `float32` only at the OpenCV infrastructure boundary.
- Direction-profile bone transforms are treated as complete rest-transform overrides before
  additive position/rotation and multiplicative scale deltas. A part without a direction or
  profile pivot uses image origin. Direction multipliers affect delta channels only; scale
  multipliers adjust the factor around identity `1`, while absolute channels remain absolute.
- Part visibility is a discrete final override, opacity deltas are additive and clamped to
  `[0, 1]`, and z-bias is a step-only integer. Clip events remain persisted metadata and are not
  emitted by AF-021 because event dispatch belongs to a later application use case.
- AF-022 implements the explicit ticket-owned decoded and premultiplied asset cache. The remaining
  whole-renderer caches in section 14.5 (topological order, clip evaluations, and optional complete
  frames) require the still-undefined `project_revision`/full renderer lifecycle and are deferred
  to AF-023 rather than introduced as unused cache stubs.
- Cubic overshoot is clamped back to `0 <= RGB <= alpha <= 1`; unpremultiplication uses float32
  epsilon, final conversion uses nearest-even NumPy rounding, and clipping defaults to alpha above
  zero. These are deterministic implementation choices where the specification provides no numeric
  epsilon, tie-breaking, or default threshold.
- Clipping detection returns edge state only. `allow_clipping` enforcement and `AFV501` emission
  remain export/application policy rather than compositor behavior.
- The specification defines no persisted asset catalog or importer-owned image-observation
  document. `AFV101` through `AFV108` therefore run when a caller supplies typed asset metadata
  and observations; CLI validation does not invent or persist an asset schema.
- Equipment usage is not modeled yet, so `AFV403` is emitted only when a caller explicitly
  supplies the used socket IDs. Orphan direction-profile override IDs are not assigned an
  invented diagnostic code where Appendix E provides no accurate one.
- The specification calls for pivots within "reasonable limits" without a numeric threshold.
  AF-012 conservatively warns outside one trimmed-image extent before zero or two extents after
  it (`[-width, 2 * width]`, `[-height, 2 * height]`) until template-specific policy exists.
- Appendix C references an undefined `Project` aggregate, while the specification defines no
  persisted asset manifest or whole-project transaction. AF-011 therefore implements the
  application port as canonical `ProjectManifest` load/save plus typed per-file rig and clip
  operations; it does not invent an aggregate schema.
- Atomicity is per JSON file, not a multi-file transaction. Migrations, backups, locking,
  autosave, recovery, and multi-writer arbitration remain assigned to later tickets.
- Stable symlink escapes are rejected before access and again before publication. A hostile
  process concurrently swapping path components would require directory-descriptor/no-follow
  traversal beyond the AF-011 desktop threat model.
- Appendix A of `docs/SPEC.md` spells two sample asset IDs as `SE_torso` and `NE_torso`,
  conflicting with the normative lowercase ASCII `snake_case` semantic-ID rule. Executable
  AF-010 examples use `se_torso` and `ne_torso`; the specification was not changed in this
  ticket.
- Background removal is optional preprocessing and is not connected to the GUI or importer.
- BiRefNet weights exist only in the local project-owned Docker volume. They are not committed,
  baked into an image, or approved for redistribution by this status record.

## Milestones

- [x] M0 Foundations
- [x] M1 Domain and persistence
- [ ] M2 Mathematics and renderer
- [ ] M3 Importer and humanoid rig
- [ ] M4 Humanoid generators
- [ ] M5 Export
- [ ] M6 Functional GUI
- [ ] M7 Sockets and equipment
- [ ] M8 Quadrupeds
- [ ] M9 Cut Studio, after the MVP

## Next permitted work

- AF-023 Golden render
