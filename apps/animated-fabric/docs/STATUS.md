# Animated Fabric status

**Target version:** 0.1.0

**Current state:** Milestones M0, M1, and M2 complete

**Last updated:** 2026-07-17

## Completed work

M0 - repository foundations.

- [x] AF-001 Bootstrap
- [x] AF-002 Diagnostics and errors
- [x] AF-003 Geometric fixtures

M1 - domain and persistence.

- [x] AF-010 Fundamental models
- [x] AF-011 JSON repository
- [x] AF-012 Validation engine

M2 - mathematics and vertical renderer.

- [x] AF-020 Transforms
- [x] AF-021 Animation evaluator
- [x] AF-022 OpenCV compositor
- [x] AF-023 Golden render

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
  RGBA plus premultiplied revisions. Keys include project/root path, `(asset_id, sha256)`, and
  decode-relevant trim metadata; every hit revalidates current path availability and containment.
- Indexed or RGBA PNG input converts to true RGBA without channel swapping. Missing optional
  assets contribute no pixels; missing required, corrupt, mismatched, or unsafe assets fail with
  typed `RenderError` exceptions.
- The OpenCV compositor uses forward float32 2x3 affine matrices, transparent borders, cubic
  sampling by default, premultiplied source-over, guarded unpremultiplication, and deterministic
  straight `uint8` RGBA bytes.
- Final-frame clipping reports top/right/bottom/left alpha contact against a configurable
  threshold without prematurely applying export policy.
- A hand-authored 4 x 3 owned golden locks exact channel order, affine placement, alpha blend,
  dimensions, and clipping behavior.
- A transient `RenderProject` closes the specification's undefined runtime-aggregate boundary
  without adding a persisted asset schema. Immutable `RenderRequest` and `RenderedFrame` values
  carry exact RGBA bytes, canvas size, ground anchor, resolved sockets, requested exact-time
  events, and clipping diagnostics.
- `OpenCvRenderer` now orchestrates authored-direction validation, cached hierarchy and clip
  evaluation, pose resolution, stable render planning, the shared OpenCV compositor, and frame
  metadata. Mirrored directions fail explicitly because complete-frame mirroring remains AF-052.
- Revision-aware bounded LRU caches retain rig topological order and direction-aware normalized
  clip evaluations. A project revision change eagerly invalidates dependent computations; image
  revisions remain independently content-addressed and project-scoped. Eviction also prunes the
  tracked project-revision registry.
- The generated `stick_humanoid` fixture now includes canonical project and rig documents. Its
  fixture-only adapter creates 28 transient `AssetLayer` values from owned manifest facts and
  does not impersonate the importer or a general asset-catalog format.
- CLI `render-frame` follows the normative root/direction/time/output shape, renders neutral SE
  and NE fixture frames, selects a clip by ID when one is present, writes RGBA PNG atomically,
  refuses destinations under immutable source roots or at referenced asset paths, returns exit 4
  with `AFR001` for expected render failures, and sanitizes unexpected failures.
- `scripts/run_demo_pipeline.py` generates the fixture and renders both authored directions
  through the same `RenderFrame` use case and renderer used by the CLI.
- Reviewed 192 x 192 neutral SE and NE goldens lock complete-pipeline draw order, alpha structure,
  metadata-safe composition, direction differences, repeatability, and absence of edge clipping.

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
- `src/animated_fabric/application/render_cache.py`
- `src/animated_fabric/application/render_frame.py`
- `src/animated_fabric/application/rendering.py`
- `src/animated_fabric/application/validation_service.py`
- `src/animated_fabric/domain/validation/`
- `src/animated_fabric/infrastructure/persistence/json_project_repository.py`
- `src/animated_fabric/infrastructure/fixtures/stick_humanoid.py`
- `src/animated_fabric/infrastructure/imaging/alpha.py`
- `src/animated_fabric/infrastructure/imaging/image_store.py`
- `src/animated_fabric/infrastructure/imaging/opencv_compositor.py`
- `src/animated_fabric/infrastructure/imaging/opencv_renderer.py`
- `src/animated_fabric/infrastructure/imaging/png_writer.py`
- `src/animated_fabric/gui/app.py`
- `scripts/generate_fixture_assets.py`
- `scripts/generate_af022_compositor_golden.py`
- `scripts/run_demo_pipeline.py`
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
- `tests/unit/test_opencv_renderer.py`
- `tests/unit/test_render_cache.py`
- `tests/unit/test_render_contracts.py`
- `tests/unit/test_cached_bone_order.py`
- `tests/unit/test_png_frame_writer.py`
- `tests/golden/af022_compositor.png`
- `tests/golden/af023_stick_humanoid_neutral_se.png`
- `tests/golden/af023_stick_humanoid_neutral_ne.png`
- `tests/integration/test_render_frame_cli.py`
- `tests/integration/test_demo_pipeline.py`
- `tests/integration/test_json_project_repository.py`
- `tests/integration/test_validate_cli.py`
- `tests/cutout/`
- `.github/workflows/animated-fabric-ci.yml` at the Caatuu repository root

## Verification

Executed on 2026-07-17 through the repository-owned Linux container after AF-023:

- `ruff format --check .`: 96 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 46 source files.
- `pytest -q`: 448 passed; 92.60% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- `python scripts/generate_fixture_assets.py --out .tmp/final-af023-fixtures`: generated the
  deterministic 28-layer fixture plus canonical project and rig documents successfully.
- `python scripts/run_demo_pipeline.py --out .tmp/final-af023-demo`: rendered neutral SE and NE
  192 x 192 RGBA frames successfully through the complete pipeline.
- Reproduced demo and committed golden PNG hashes matched byte for byte: SE
  `0b2632ea0670e3d66931a849acfaeb76256d6800e6103931ed89cb22d764b6d4`; NE
  `2d416e98997e8f6cde343f3213947b3e54e4ed97564ccdd544de25d6644144d0`.
- `python -m animated_fabric --help`: passed and listed `render-frame`.
- `python -m animated_fabric doctor`: passed with no problems.
- CLI `render-frame` against `.tmp/final-af023-fixtures/stick_humanoid` in direction NE at
  0 ms: passed and wrote `.tmp/final-af023-cli-ne.png`.
- Golden tests decoded RGBA pixels, enforced exact 192 x 192 dimensions and alpha structure,
  allowed at most channel difference 2 and 0.1% out-of-tolerance pixels, and passed exactly.

Infrastructure and cutout checks retained from the preceding M0/M1 verification recorded on
2026-07-16:

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
- The authored-direction renderer is complete for M2, but the general importer, complete-frame
  mirroring, animation generators, and export execution do not exist yet. `render-frame` therefore
  accepts the owned generated fixture project only; it does not scan arbitrary layer folders.
- Domain matrices deliberately use immutable Python floats because the normative dependency rule
  permits only the standard library and Pydantic in `domain`. AF-022 converts to contiguous NumPy
  `float32` only at the OpenCV infrastructure boundary.
- Direction-profile bone transforms are treated as complete rest-transform overrides before
  additive position/rotation and multiplicative scale deltas. A part without a direction or
  profile pivot uses image origin. Direction multipliers affect delta channels only; scale
  multipliers adjust the factor around identity `1`, while absolute channels remain absolute.
- Part visibility is a discrete final override, opacity deltas are additive and clamped to
  `[0, 1]`, and z-bias is a step-only integer. A render request may return events declared exactly
  at its normalized sample time; interval-crossing dispatch semantics remain unspecified.
- The full renderer caches topological order and evaluated clips against a transient non-negative
  `project_revision`. No mutation service or persisted revision exists yet, so future mutation
  tickets must construct the incremented runtime aggregate or explicitly invalidate the cache.
  The optional complete-frame cache remains unimplemented.
- Cubic overshoot is clamped back to `0 <= RGB <= alpha <= 1`; unpremultiplication uses float32
  epsilon, final conversion uses nearest-even NumPy rounding, and clipping defaults to alpha above
  zero. These are deterministic implementation choices where the specification provides no numeric
  epsilon, tie-breaking, or default threshold.
- Clipping detection returns edge state only. `allow_clipping` enforcement and `AFV501` emission
  remain export/application policy rather than compositor behavior.
- The specification defines no persisted asset catalog or importer-owned image-observation
  document. `AFV101` through `AFV108` therefore run when a caller supplies typed asset metadata
  and observations; CLI validation does not invent or persist an asset schema. The AF-023 fixture
  adapter reads only the owned `fixture_manifest.json` convention and is not a product format.
- Equipment usage is not modeled yet, so `AFV403` is emitted only when a caller explicitly
  supplies the used socket IDs. Orphan direction-profile override IDs are not assigned an
  invented diagnostic code where Appendix E provides no accurate one.
- The specification calls for pivots within "reasonable limits" without a numeric threshold.
  AF-012 conservatively warns outside one trimmed-image extent before zero or two extents after
  it (`[-width, 2 * width]`, `[-height, 2 * height]`) until template-specific policy exists.
- Appendix C references an undefined `Project` aggregate, while the specification defines no
  persisted asset manifest or whole-project transaction. Persistence remains canonical
  `ProjectManifest` load/save plus typed per-file rig and clip operations. AF-023 adds a transient
  immutable `RenderProject` containing the approved root, manifest, typed assets, and revision;
  it does not invent an aggregate schema on disk.
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
- [x] M2 Mathematics and renderer
- [ ] M3 Importer and humanoid rig
- [ ] M4 Humanoid generators
- [ ] M5 Export
- [ ] M6 Functional GUI
- [ ] M7 Sockets and equipment
- [ ] M8 Quadrupeds
- [ ] M9 Cut Studio, after the MVP

## Next permitted work

- AF-030 Layer importer
