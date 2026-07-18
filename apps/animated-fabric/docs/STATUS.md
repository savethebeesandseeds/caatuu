# Animated Fabric status

**Target version:** 0.1.0

**Current state:** Milestones M0 through M4 complete

**Last updated:** 2026-07-18

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

M3 - importer and humanoid rig.

- [x] AF-030 Layer importer
- [x] AF-031 Template registry
- [x] AF-032 Humanoid rig application
- [x] AF-033 Rig editing

M4 - humanoid generators.

- [x] AF-040 Interpolation and clip builder
- [x] AF-041 `humanoid_idle_v1`
- [x] AF-042 `humanoid_walk_v1`
- [x] AF-043 Animation CLI

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
- A side-effect-free `LayerImporter.inspect()` and shared `ImportLayerSet` application boundary now
  inspect and publish direct direction-specific PNG folders without GUI or CLI logic in the adapter.
- The folder importer accepts RGBA and indexed-transparent PNGs, verifies the PNG signature, decodes
  in stable filename order, calculates alpha-only bounds, converts to deterministic RGBA, optionally
  trims transparent borders, and preserves the original canvas and exact `trim_origin` metadata.
- Configurable 2048 px, 50 MiB, and 500-layer limits are enforced before publication. Corrupt or
  unsupported inputs, nonrecursive entries, case-colliding names, unsafe links, invalid mappings,
  duplicate semantic parts, and immutable destination conflicts fail with actionable diagnostics.
- The four alias groups listed in specification section 8.6 produce deterministic English semantic
  proposals; callers confirm every assignment, and CLI users may provide repeatable
  `--map SOURCE.png=semantic_part` overrides.
- Normalized layers publish beneath `source/layers/<DIRECTION>/` through project-local staging and
  no-overwrite hard links. A failed batch rolls back every newly published PNG and leaves the prior
  catalog authoritative; byte- and metadata-identical retries are deterministic no-ops.
- A strict root `layers.manifest.json` with format `animated-fabric.layer-manifest.v1` persists sorted
  `AssetLayer` values through the hardened atomic JSON repository without changing `ProjectManifest`.
  Decision 0001 records this narrow resolution of the specification's previously undefined catalog.
- CLI `import-layers ROOT --direction ... --source ...` displays mappings for confirmation, supports
  trim control and JSON diagnostics, exits 3 for expected input/import failures, and sanitizes
  unexpected boundary failures with exit 10.
- The shared import use case requires a valid canonical project, rejects mirrored or undeclared
  target directions, and verifies every source layer against the fixed project canvas before any
  source publication. JSON mode exposes proposals as `AFI010` information diagnostics.
- An application-owned `RigTemplateRegistry` port and eager package-resource adapter list and load
  fixed built-in templates without deriving paths from caller input or reading project files.
- Strict, deeply immutable template records validate stable `0.1.x` identity, one rooted acyclic
  bone graph, part ownership, aliases, sockets, draw slots, compatible generator IDs, and bounded
  initial numeric values against matching limits.
- The packaged `humanoid_v1` resource contains the normative 17-bone hierarchy, 14 required and
  six named optional parts, all four alias groups, eight initial sockets, the 15-slot inventory,
  and the compatible idle/walk generator IDs without executable configuration.
- Resource decoding rejects invalid UTF-8, malformed or non-object JSON, duplicate keys at any
  depth, nonstandard numeric constants, oversized documents, unsupported schemas, unknown fields,
  filename/ID disagreement, and ambiguous registry entries through `RigDefinitionError`.
- The JSON resource is explicit wheel package data; CI builds a wheel offline and loads the
  template from that wheel outside the checkout. Decision 0002 records the resource boundary;
  Decision 0003 resolves the application-owned geometry and direction-profile choices.
- Application-owned `ApplyRigTemplate` orchestration now loads the project, layer catalog, and
  declared built-in template through typed ports; constructs the complete rig before publication;
  validates it; and performs one atomic save without changing the project or layer documents.
- The `humanoid_v1` application policy scales a reviewed 192 x 192 reference skeleton around the
  project's ground anchor, derives parent-relative rest transforms, and reconstructs each trimmed
  asset pivot from its canvas-space bone joint and persisted `trim_origin`.
- Exact semantic-part mapping creates bindings for every required authored-direction asset.
  Required omissions fail before publication; an entirely absent optional part is accepted, an
  optional one-view binding is hidden with a warning, and unmatched catalog parts remain validator
  warnings rather than guessed assignments.
- All eight template sockets receive application-owned scaled local offsets. Complete SE and NE
  profiles reorder fixed anatomical far/near binding slots deterministically within the
  direction-invariant `PartBinding.draw_slot` schema.
- CLI `rig apply-template ROOT` invokes the same use case, supports JSON diagnostics, and requires
  explicit `--replace-existing` confirmation before replacing an existing rig. The dedicated
  AF-032 demo imports the owned SE/NE layers into a fresh project, applies the rig, renders both
  reviewed neutral frames, and writes bone/socket overlays. Decision 0003 records the policies.
- Unconfirmed rig publication uses an atomic no-replace hard link at the repository boundary, so a
  concurrent writer cannot turn the existence check into a silent overwrite; replacement does not
  parse or allocate an arbitrary pre-existing rig document.
- Application-owned `UpdateRigElement` orchestration provides frozen typed operations for moving a
  bone, moving a pivot, assigning an existing part to a bone, and changing its draw slot without
  coupling the rig model to Qt or a presentation surface.
- Bone and pivot edits target one authored direction profile and preserve base values, rotation,
  scale, the other direction, and stable tuple ordering. Locked bones, mirrored directions,
  missing or ambiguous targets, pivots without selected assets, and unknown slots fail before a
  write.
- Each detached candidate is validated with the project layer catalog before exactly one atomic rig
  replacement. Warning-only edits may publish; exact-value updates are write-free no-ops and report
  a transient revision delta of zero rather than inventing a persisted revision field.
- Effective direction-profile pivots are validated against effective profile-selected assets, so
  rendered overrides receive the same `AFV206` bounds warning as base binding pivots. Decision 0004
  records assignment, direction, revision, CLI, and deferred undo semantics.
- Application-owned `AnimationClipBuilder` accepts a frozen `AnimationClipBuildRequest` and returns
  a detached typed clip without retaining mutable state. It owns fixed
  `animated-fabric.animation-clip.v1` / `0.1.0` metadata and derives the template ID from the rig.
- Track declaration order is preserved while keys and events are stably sorted by time. Key values
  and interpolation modes survive normalization; event ties and duplicates remain distinct, and
  recursive provenance parameters are defensively copied with canonical map order.
- A looping track without an explicit duration endpoint receives one matching its first value and
  interpolation mode. Authored duration endpoints remain unchanged, invalid authored data keeps
  the existing `AFV` diagnostics, warning-only clips return a value, and typed construction failures
  use bounded `AFB001` diagnostics.
- Focused normalization, detachment, diagnostic, determinism, and boundary tests accompany accepted
  decision 0005; the builder does not duplicate interpolation or rig-aware validation policy.
- Pure `HumanoidIdleV1Generator` and strict frozen `HumanoidIdleV1Parameters` implement the direct
  clip-return contract without IO. Defaults and recommended-range metadata follow specification
  section 12.2; unknown, coerced, negative, non-finite, and structurally unsafe inputs fail safely.
- Six fixed-order smooth bone-delta tracks implement the exact torso, head, pelvis, and upper-arm
  idle coefficients. Cumulative integer-floor quarters support every duration of at least 4 ms, and
  AF-040 supplies the matching loop endpoint without a competing generator rule.
- Generation reconstructs detached effective rig and parameter values before use. Incompatible or
  post-mutated inputs and builder failures become bounded typed `AnimationError` messages without
  exposing submitted nested values; provenance records all six effective parameters.
- The AF-041 demo imports the owned SE/NE layers into a fresh project, applies the real 17-bone
  humanoid rig, generates the clip in memory, renders all eight authored-direction quarter frames,
  and verifies a byte snapshot showing that no clip or manifest update was published.
- Four reviewed SE/NE goldens at time zero and the first quarter lock the visible breath and
  counter-motion. Focused unit and full-rig integration tests also cover periodic closure, the final
  loop quarter, deterministic repetition, validation, clipping, and project immutability. Decision
  0006 records the parameter, phase, identity, diagnostic-context, and deferred-publication rules.
- Pure `HumanoidWalkV1Generator` and strict frozen `HumanoidWalkV1Parameters` implement all nine
  section 12.3 defaults without inventing hard maxima. Unknown, coerced, negative, non-finite, and
  structurally unsafe inputs fail through bounded typed errors.
- Twelve fixed-order smooth bone-delta tracks implement the exact quarter-phase FK gait, including
  opposed thighs and arms, pelvis/head counter-motion, torso bob, negative shin counter-bend, and
  local-Y foot lift. Cumulative floor quarters support every duration of at least 4 ms, and AF-040
  supplies the loop endpoint without adding IK.
- Fixed `foot_contact_l` and `foot_contact_r` events use the zero and half-cycle floor phases.
  Provenance records all nine effective parameters, including defaults.
- Private shared generator support now provides callback-hardened strict parameter handling,
  canonical finite amplitudes, bounded parameter errors, and detached full-rig validation for both
  idle and walk without sharing their motion tables.
- The AF-042 demo imports and applies the owned full 17-bone SE/NE rig, generates the walk clip in
  memory, renders all eight quarter-phase candidates, and proves the project and manifest remain
  unchanged. A private demo helper shares only this full-rig bootstrap and rendering machinery.
- Six reviewed SE/NE goldens at `t_0`, `t_1`, and `t_2` lock the required walk samples. The `t_0`
  and `t_2` pixels are intentionally identical while their left/right contact events remain
  distinct; numeric and visual inspection also cover the `t_3` right-forward crossover. Decision
  0007 records the exact table, identity, timing, event, validation, and AF-043 deferral rules.
- A fixed application-owned `AnimationGeneratorRegistry` exposes idle and walk summaries in stable
  ID order and invokes only package-owned implementations. Parameter summaries retain strict types,
  defaults, hard minima, and idle recommendation metadata without exposing raw Pydantic schemas or
  adding dynamic plugin discovery.
- `GenerateAnimation` loads the declared project and rig, verifies template compatibility, rebuilds
  the selected clip identity through `AnimationClipBuilder`, rejects ambiguous registered paths or
  IDs, and validates the complete candidate animation set before publication.
- New clips publish atomically with no-replace semantics at
  `animations/<clip_id>.animated-clip.json` and append once to the manifest in stable order. Existing
  registered clips require explicit replacement and retain their registered path; an unregistered
  collision is never overwritten.
- A failed manifest update leaves the newly created clip in place and reports it as unregistered.
  Automatic deletion is intentionally unsafe without project locking because another process may
  already have registered the same bytes. Clip-first ordering still prevents this process from
  publishing a manifest reference before the clip exists; AF-060 retains locking and recovery.
- CLI `animation list-generators --template ...` displays the normalized parameter contract, and
  `animation generate ROOT --generator ... --clip ...` accepts bounded repeatable JSON-scalar
  `--set` values, emits stable human or JSON results, and sanitizes unexpected boundary failures.
  Decision 0008 records discovery, naming, validation, replacement, rollback, and wire policies.

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
- `src/animated_fabric/domain/generators.py`
- `src/animated_fabric/domain/export.py`
- `src/animated_fabric/domain/templates.py`
- `src/animated_fabric/application/ports.py`
- `src/animated_fabric/application/humanoid_rig.py`
- `src/animated_fabric/application/apply_rig_template.py`
- `src/animated_fabric/application/update_rig_element.py`
- `src/animated_fabric/application/animation_clip_builder.py`
- `src/animated_fabric/application/generate_animation.py`
- `src/animated_fabric/generators/__init__.py`
- `src/animated_fabric/generators/_support.py`
- `src/animated_fabric/generators/registry.py`
- `src/animated_fabric/generators/humanoid_idle_v1.py`
- `src/animated_fabric/generators/humanoid_walk_v1.py`
- `src/animated_fabric/application/import_layers.py`
- `src/animated_fabric/application/render_cache.py`
- `src/animated_fabric/application/render_frame.py`
- `src/animated_fabric/application/rendering.py`
- `src/animated_fabric/application/validation_service.py`
- `src/animated_fabric/domain/validation/`
- `src/animated_fabric/infrastructure/json_document.py`
- `src/animated_fabric/infrastructure/persistence/json_project_repository.py`
- `src/animated_fabric/templates/registry.py`
- `src/animated_fabric/templates/resources/humanoid_v1.json`
- `src/animated_fabric/infrastructure/fixtures/stick_humanoid.py`
- `src/animated_fabric/infrastructure/importing/folder_layer_importer.py`
- `src/animated_fabric/infrastructure/imaging/alpha.py`
- `src/animated_fabric/infrastructure/imaging/image_store.py`
- `src/animated_fabric/infrastructure/imaging/opencv_compositor.py`
- `src/animated_fabric/infrastructure/imaging/opencv_renderer.py`
- `src/animated_fabric/infrastructure/imaging/png_writer.py`
- `src/animated_fabric/gui/app.py`
- `scripts/generate_fixture_assets.py`
- `scripts/generate_af022_compositor_golden.py`
- `scripts/run_demo_pipeline.py`
- `scripts/run_rig_application_demo.py`
- `scripts/_humanoid_animation_demo.py`
- `scripts/run_idle_animation_demo.py`
- `scripts/run_walk_animation_demo.py`
- `tools/cutout/`
- `Dockerfile.cutout`, `requirements-cutout-*.txt`, and `docs/CUTOUT.md`
- `tests/unit/`
- `docs/decisions/0008-animation-generation-cli.md`
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
- `tests/golden/af041_humanoid_idle_se_t0000.png`
- `tests/golden/af041_humanoid_idle_se_t0500.png`
- `tests/golden/af041_humanoid_idle_ne_t0000.png`
- `tests/golden/af041_humanoid_idle_ne_t0500.png`
- `tests/golden/af042_humanoid_walk_se_t0000.png`
- `tests/golden/af042_humanoid_walk_se_t0200.png`
- `tests/golden/af042_humanoid_walk_se_t0400.png`
- `tests/golden/af042_humanoid_walk_ne_t0000.png`
- `tests/golden/af042_humanoid_walk_ne_t0200.png`
- `tests/golden/af042_humanoid_walk_ne_t0400.png`
- `tests/golden/README.md`
- `tests/integration/test_render_frame_cli.py`
- `tests/integration/test_demo_pipeline.py`
- `tests/integration/test_json_project_repository.py`
- `tests/integration/test_validate_cli.py`
- `tests/unit/test_import_layers.py`
- `tests/unit/test_folder_layer_importer.py`
- `tests/unit/test_layer_manifest.py`
- `tests/integration/test_folder_layer_import_security.py`
- `tests/integration/test_import_layers_cli.py`
- `tests/integration/test_layer_manifest_repository.py`
- `tests/unit/test_rig_template_models.py`
- `tests/unit/test_template_registry.py`
- `tests/integration/test_template_package_resource.py`
- `tests/unit/test_humanoid_rig.py`
- `tests/integration/test_apply_rig_template.py`
- `tests/integration/test_apply_rig_template_cli.py`
- `tests/integration/test_imported_fixture_rig.py`
- `tests/integration/test_rig_application_demo.py`
- `tests/unit/test_update_rig_element.py`
- `tests/unit/test_animation_clip_builder.py`
- `tests/unit/test_humanoid_idle_v1.py`
- `tests/unit/test_humanoid_walk_v1.py`
- `tests/integration/test_animation_clip_builder.py`
- `tests/integration/test_humanoid_idle_v1.py`
- `tests/integration/test_humanoid_walk_v1.py`
- `tests/integration/test_update_rig_element.py`
- `docs/decisions/0001-layer-manifest.md`
- `docs/decisions/0002-rig-template-resource.md`
- `docs/decisions/0003-humanoid-rig-application.md`
- `docs/decisions/0004-rig-editing-use-cases.md`
- `docs/decisions/0005-animation-clip-normalization.md`
- `docs/decisions/0006-humanoid-idle-generator.md`
- `docs/decisions/0007-humanoid-walk-generator.md`
- `tests/cutout/`
- `.github/workflows/animated-fabric-ci.yml` at the Caatuu repository root

## Verification

Executed on 2026-07-18 through the repository-owned Linux container after AF-043:

- `ruff format --check .`: 199 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 65 source files.
- `pytest -q`: 808 passed; 92.75% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- `python scripts/generate_fixture_assets.py --out .tmp/af043-final-fixtures`: generated the
  deterministic geometric humanoid fixture and canonical fixture project.
- `python scripts/run_demo_pipeline.py --out .tmp/af043-final-demo`: rendered the reviewed neutral
  SE and NE fixture frames successfully after the final concurrency correction.
- A fresh rig-application demo imported both authored directions, applied the 17-bone humanoid rig,
  and rendered SE/NE frames and overlays. The public animation CLI then listed both built-ins with
  schemas, generated persisted `idle` and overridden `walk` clips, and passed `validate` with no
  problems. An unconfirmed replacement returned `AFG003`; confirmed JSON replacement returned `[]`.
- `python -m animated_fabric doctor` reported no problems, and animation help exposed
  `list-generators` and `generate` with English descriptions.
- Root repository file-policy and Markdown-link checks passed for 1,205 candidate files and 87
  Markdown files before the final status record; the Markdown checks were rerun after this update.
- Independent application, CLI, persistence, and adversarial concurrency reviews found no remaining
  actionable defect. Unsafe automatic deletion after a manifest failure was removed before the
  final gates.

Executed on 2026-07-18 through the repository-owned Linux container after AF-042:

- `ruff format --check .`: 192 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 62 source files.
- `pytest -q`: 749 passed; 93.06% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Fresh neutral, eight-frame idle, and eight-frame walk demos completed successfully with the real
  SE/NE rig. Their reviewed samples matched, and the in-memory animation demos did not publish clips
  or change either project manifest.
- AF-042 walk golden SHA-256 digests were SE at 0 and 400 ms
  `0b2632ea0670e3d66931a849acfaeb76256d6800e6103931ed89cb22d764b6d4`, SE at 200 ms
  `14816d5bb742b318c2b79c15ec6069306077dc9309fa00caa4817aa54f81400c`, NE at 0 and 400 ms
  `2d416e98997e8f6cde343f3213947b3e54e4ed97564ccdd544de25d6644144d0`, and NE at 200 ms
  `f56397a3f98574e3926e5933952ba9aded8619de4295cff685be326ce0e42460`.
- The previously recorded AF-023 neutral and AF-041 idle golden hashes were unchanged.
- `python -m animated_fabric --help` and `python -m animated_fabric doctor`: CLI help passed and
  doctor reported no problems.

Executed on 2026-07-18 through the repository-owned Linux container after AF-041:

- `ruff format --check .`: 186 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 60 source files.
- `pytest -q`: 707 passed; 93.13% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- The neutral SE/NE demo and eight-frame SE/NE idle demo completed successfully. Final neutral
  outputs byte-matched both AF-023 goldens, and the four reviewed AF-041 samples also matched.
- AF-041 idle golden SHA-256 digests were SE at 0 ms
  `2e00e27fd454378fa8138c0279eb05ae117f547cde81dc1fba2134c979480340`, SE at 500 ms
  `c92cc37bdb4cd56e743fd0a029eec28c56e0ec8573debd664ea786a5628be6f6`, NE at 0 ms
  `0413bb2ee39900bcd5ab12fc5db87dde47297658b358cf66830357e2408d128f`, and NE at 500 ms
  `e461d6a0bebacbd09f79db96d591c6066de9edb761c0b16377864d59f66c1cf7`.
- `python -m animated_fabric --help` and `python -m animated_fabric doctor`: CLI help passed and
  doctor reported no problems.

Executed on 2026-07-18 through the repository-owned Linux container after AF-040:

- `ruff format --check .`: 181 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 58 source files.
- `pytest -q`: 676 passed; 93.02% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Fixture generation, the demo pipeline, `python -m animated_fabric --help`, and
  `python -m animated_fabric doctor` all completed successfully.
- Demo output matched both reviewed goldens exactly. The SE SHA-256 digest was
  `0b2632ea0670e3d66931a849acfaeb76256d6800e6103931ed89cb22d764b6d4`; the NE digest was
  `2d416e98997e8f6cde343f3213947b3e54e4ed97564ccdd544de25d6644144d0`.

Executed on 2026-07-17 through the repository-owned Linux container after AF-033:

- `ruff format --check .`: 178 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 57 source files.
- `pytest -q`: 654 passed; 92.91% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Focused AF-033 unit and rig-validation suite: 52 passed.
- Focused AF-033 real-repository integration and render suite: 15 passed.
- `python scripts/generate_fixture_assets.py --out .tmp/final-af033-fixtures-650`:
  generated the deterministic 28-layer owned fixture and canonical fixture project.
- `python scripts/run_demo_pipeline.py --out .tmp/final-af033-demo-650`: rendered the reviewed
  neutral frames and matched both goldens exactly. The SE SHA-256 digest was
  `0b2632ea0670e3d66931a849acfaeb76256d6800e6103931ed89cb22d764b6d4`; the NE digest was
  `2d416e98997e8f6cde343f3213947b3e54e4ed97564ccdd544de25d6644144d0`.
- `python -m animated_fabric --help`, `python -m animated_fabric rig --help`, and
  `python -m animated_fabric doctor`: CLI help passed and doctor reported no problems.
- Final code- and test-review gaps were addressed before the focused and complete suites passed.

Executed on 2026-07-17 through the repository-owned Linux container after AF-032:

- `ruff format --check .`: 175 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 56 source files.
- `pytest -q`: 605 passed; 92.60% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Focused rig-application, repository, CLI, imported-render, and project-validator suite:
  79 passed.
- `python scripts/generate_fixture_assets.py --out .tmp/final-af032-fixtures-605`:
  generated the deterministic 28-layer owned fixture and canonical fixture project.
- `python scripts/run_demo_pipeline.py --out .tmp/final-af032-legacy-demo-605`: rendered the
  reviewed 192 x 192 neutral SE and NE fixture frames.
- `python scripts/run_rig_application_demo.py --out .tmp/final-af032-demo-reviewed-605`:
  imported both layer sets, applied a 17-bone/14-part/8-socket rig, validated the persisted
  project, and rendered both neutral frames plus bone/socket overlays. The neutral SE and NE
  SHA-256 digests remained `0b2632ea...d764b6d4` and `2d416e98...644144d0`.
- `python -m animated_fabric --help`, `python -m animated_fabric rig --help`, and
  `python -m animated_fabric doctor`: public entry points passed; doctor reported no problems.
- Root repository file-policy and Markdown-link checks: passed for 1,165 candidate files and 82
  Markdown files.
- Push-triggered GitHub Actions `Repository CI` run 29612316036 and `Animated Fabric CI` run
  29612316041 both completed successfully on commit `d48e1df`.
- Independent final code, test, and security reviews reported no remaining actionable findings.

Executed on 2026-07-17 through the repository-owned Linux container after AF-031:

- `docker compose build animated-fabric-dev`: passed with the container-owned offline wheel
  toolchain present in the development environment.
- `docker compose config --quiet` and the complete profile configuration: passed.
- `ruff format --check .`: 167 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 54 source files.
- `pytest -q`: 578 passed; 92.39% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Root repository file-policy and Markdown-link checks: passed for 1,156 candidate files and 81
  Markdown files.
- Offline `pip wheel --no-deps --no-build-isolation`: built
  `animated_fabric-0.1.0-py3-none-any.whl`; an isolated process outside the checkout imported the
  package from the wheel and loaded all 17 `humanoid_v1` bones through `importlib.resources`.
- A read-only, networkless baked-image smoke loaded `humanoid_v1` with 17 bones and no checkout
  mount.
- `python scripts/generate_fixture_assets.py --out .tmp/final-af031-fixtures`: generated the
  deterministic 28-layer owned fixture and canonical fixture project successfully.
- `python -m animated_fabric doctor`: passed with no problems found.

Executed on 2026-07-17 through the repository-owned Linux container after AF-030:

- `ruff format --check .`: 105 files already formatted.
- `ruff check .`: all checks passed.
- `mypy src`: no issues in 49 source files.
- `pytest -q`: 512 passed; 91.96% branch coverage against an 85% floor.
- `python -m pip check`: no broken requirements.
- Focused importer, catalog, transaction, and CLI suite: 64 passed.
- `python scripts/generate_fixture_assets.py --out .tmp/final-af030-fixtures`: generated the
  deterministic 28-layer owned fixture and canonical fixture project successfully.
- CLI `import-layers` imported the fixture's 14 SE and 14 NE layers into a validated project root
  with explicit noninteractive confirmation; each JSON result contained only the 14 stable `AFI010`
  mapping information diagnostics.
- The persisted `layers.manifest.json` reloaded with 28 layers, directions exactly `NE,SE`, and only
  project-relative asset paths.
- `python -m animated_fabric --help`: passed and listed `import-layers`.
- `python -m animated_fabric doctor`: passed with no problems found.

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

- Persisted project, rig, and layer-catalog JSON still lack global file-size and collection-count
  bounds. Add both before production use accepts untrusted projects.
- Frozen domain models still expose mutable nested mappings. Resolve deep immutability or enforce
  controller-owned defensive copies before the AF-060 long-lived document controller.
- AF-033 edit dataclasses currently rely on trusted typed callers. Validate externally derived
  values before GUI or plugin deserialization can construct rig-edit requests.
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
- The authored-direction renderer, general layer importer, template registry and application,
  rig-editing use cases, clip builder, built-in generator registry, `GenerateAnimation`, animation
  persistence, and animation CLI exist. General imported-catalog loading and complete-frame
  mirroring are still absent from `render-frame`, so that command continues to accept the owned
  generated fixture project only. Export execution and animation GUI controls remain later work.
- AF-043 derives new destinations from validated clip IDs and retains a unique existing registered
  path during replacement. Per-file publication is atomic, but a failed manifest write or process
  crash after clip creation may leave a reported unreferenced file. It is not automatically deleted
  because another process could already have registered it; locking, recovery, and multi-writer
  arbitration remain AF-060 work. Recommended idle ranges remain schema metadata rather than hard
  validity bounds, and walk has no invented recommendations or maxima.
- Domain matrices deliberately use immutable Python floats because the normative dependency rule
  permits only the standard library and Pydantic in `domain`. AF-022 converts to contiguous NumPy
  `float32` only at the OpenCV infrastructure boundary.
- Direction-profile bone transforms are treated as complete rest-transform overrides before
  additive position/rotation and multiplicative scale deltas. A part without a direction or
  profile pivot uses image origin. Direction multipliers affect delta channels only; scale
  multipliers adjust the factor around identity `1`, while absolute channels remain absolute.
- Part visibility is a discrete final override, opacity deltas are additive and clamped to
  `[0, 1]`, and z-bias is a step-only integer. AF-040 preserves an event authored at `duration_ms`;
  exact event-at-duration sampling for a loop remains renderer-defined, and interval-crossing
  dispatch semantics remain unspecified.
- The full renderer caches topological order and evaluated clips against a transient non-negative
  `project_revision`. AF-033 reports a revision delta for the future document controller but does
  not persist or globally own that counter; AF-060 must apply it to the runtime aggregate for eager
  invalidation. Rig fingerprints already prevent stale hits. The optional complete-frame cache
  remains unimplemented.
- Cubic overshoot is clamped back to `0 <= RGB <= alpha <= 1`; unpremultiplication uses float32
  epsilon, final conversion uses nearest-even NumPy rounding, and clipping defaults to alpha above
  zero. These are deterministic implementation choices where the specification provides no numeric
  epsilon, tie-breaking, or default threshold.
- Clipping detection returns edge state only. `allow_clipping` enforcement and `AFV501` emission
  remain export/application policy rather than compositor behavior.
- The specification names `layers.manifest.json` but does not define its product or optional
  source-side schema. Decision 0001 defines the smallest root product catalog needed by AF-030;
  optional same-named files inside selected source folders are tolerated but not interpreted as
  mapping input. The AF-023 `fixture_manifest.json` remains an owned fixture convention, not a
  product format.
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
- Rig editing is therefore atomic but currently last-writer-wins across concurrent processes. The
  project lock, stale-lock handling, autosave, and recovery remain AF-060 concerns.
- Import rollback covers expected runtime failures and preserves the authoritative prior catalog,
  but no multi-process project lock or crash-recovery journal exists yet. Publication relies on
  same-filesystem hard links from project-local staging; filesystems without hard-link support fail
  safely rather than falling back to a non-atomic copy.
- Stable symlink escapes are rejected before access and again before publication. A hostile
  process concurrently swapping path components would require directory-descriptor/no-follow
  traversal beyond the AF-011 desktop threat model.
- Appendix A of `docs/SPEC.md` spells two sample asset IDs as `SE_torso` and `NE_torso`,
  conflicting with the normative lowercase ASCII `snake_case` semantic-ID rule. Executable
  AF-010 examples use `se_torso` and `ne_torso`; the specification was not changed in this
  ticket.
- The specification does not define complete humanoid transforms, most socket offsets, or full
  direction-specific slot arrays. Decision 0003 records the reviewed AF-032 application defaults.
  `PartBinding.draw_slot` remains direction-invariant, so anatomical far/near slots are fixed and
  the SE/NE profiles reorder those slots; per-direction slot reassignment would require migration.
- Background removal is optional preprocessing and is not connected to the GUI or importer.
- BiRefNet weights exist only in the local project-owned Docker volume. They are not committed,
  baked into an image, or approved for redistribution by this status record.

## Milestones

- [x] M0 Foundations
- [x] M1 Domain and persistence
- [x] M2 Mathematics and renderer
- [x] M3 Importer and humanoid rig
- [x] M4 Humanoid generators
- [ ] M5 Export
- [ ] M6 Functional GUI
- [ ] M7 Sockets and equipment
- [ ] M8 Quadrupeds
- [ ] M9 Cut Studio, after the MVP

## Next permitted work

- AF-050 Frame exporter
