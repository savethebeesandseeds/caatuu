"""Unit coverage for AF-050 project-export orchestration and diagnostics."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from animated_fabric.application.export_service import (
    EXPORT_CLIPPING_CODE,
    EXPORT_DESTINATION_CODE,
    EXPORT_FAILURE_CODE,
    EXPORT_PROFILE_CODE,
    ExportProject,
    ExportProjectRequest,
)
from animated_fabric.application.exporting import (
    AnimationExportResult,
    ExportRequest,
    ExportResult,
)
from animated_fabric.application.ports import ProjectExporter
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import (
    ExportError,
    ExportFailureKind,
    ProjectValidationError,
    ProjectVersionError,
)
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import BoneDefinition, RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput


def _project(
    *animation_paths: str,
    template_id: str = "humanoid_v1",
    canvas_width: int = 192,
    canvas_height: int = 192,
) -> ProjectManifest:
    return ProjectManifest.model_validate_json(
        json.dumps(
            {
                "format": "animated-fabric.project.v1",
                "schema_version": "0.1.0",
                "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
                "slug": "test_actor",
                "display_name": "Test actor",
                "template_id": template_id,
                "canvas": {
                    "width": canvas_width,
                    "height": canvas_height,
                    "ground_anchor": [96.0, 160.0],
                    "pixel_snap": "none",
                },
                "directions": {
                    "SE": {"mode": "authored"},
                    "SW": {"mode": "mirror", "source": "SE"},
                    "NE": {"mode": "authored"},
                    "NW": {"mode": "mirror", "source": "NE"},
                },
                "rig_path": "rig/main.animated-rig.json",
                "animation_paths": animation_paths,
                "export_profiles": ["default_grid"],
                "selection_ellipse": {
                    "center_offset": [0.0, -2.0],
                    "radius_x": 20.0,
                    "radius_y": 9.0,
                },
            }
        )
    )


def _rig(template_id: str = "humanoid_v1") -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=(BoneDefinition(bone_id="root"),),
    )


def _clip(
    clip_id: str,
    *,
    template_id: str = "humanoid_v1",
    duration_ms: int = 1000,
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name=clip_id.replace("_", " ").title(),
        template_id=template_id,
        duration_ms=duration_ms,
        loop=True,
        fps_hint=12,
    )


def _layers() -> LayerManifest:
    return LayerManifest(
        format="animated-fabric.layer-manifest.v1",
        schema_version="0.1.0",
        layers=(),
    )


class FakeProjectRepository:
    """Return controlled project documents and record every read boundary."""

    def __init__(
        self,
        project: ProjectManifest,
        animations: Mapping[str, AnimationClip],
        *,
        rig: RigDefinition | None = None,
        project_error: ProjectValidationError | ProjectVersionError | None = None,
        rig_error: ProjectValidationError | ProjectVersionError | None = None,
        animation_error: ProjectValidationError | ProjectVersionError | None = None,
    ) -> None:
        self.project = project
        self.rig = rig or _rig()
        self.animations = dict(animations)
        self.project_error = project_error
        self.rig_error = rig_error
        self.animation_error = animation_error
        self.project_roots: list[Path] = []
        self.rig_loads: list[tuple[Path, ProjectPath]] = []
        self.animation_loads: list[tuple[Path, ProjectPath]] = []

    def load(self, root: Path) -> ProjectManifest:
        self.project_roots.append(root)
        if self.project_error is not None:
            raise self.project_error
        return self.project

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        self.rig_loads.append((root, path))
        if self.rig_error is not None:
            raise self.rig_error
        return self.rig

    def load_animation(self, root: Path, path: ProjectPath) -> AnimationClip:
        self.animation_loads.append((root, path))
        if self.animation_error is not None:
            raise self.animation_error
        return self.animations[path]


class FakeLayerRepository:
    """Return one catalog or a typed persistence failure."""

    def __init__(
        self,
        manifest: LayerManifest | None = None,
        *,
        error: ProjectValidationError | ProjectVersionError | None = None,
    ) -> None:
        self.manifest = manifest or _layers()
        self.error = error
        self.roots: list[Path] = []

    def load_layer_manifest(self, root: Path) -> LayerManifest:
        self.roots.append(root)
        if self.error is not None:
            raise self.error
        return self.manifest


class StubValidator(ProjectValidator):
    """Return controlled diagnostics while recording the complete aggregate."""

    def __init__(self, diagnostics: Sequence[Diagnostic] = ()) -> None:
        self.diagnostics = tuple(diagnostics)
        self.inputs: list[ValidationInput] = []

    def validate(self, value: ValidationInput) -> tuple[Diagnostic, ...]:
        self.inputs.append(value)
        return self.diagnostics


class FakeExporter:
    """Record the low-level request and return or raise one controlled outcome."""

    exporter_id = "frame_sequence"

    def __init__(self, error: ExportError | None = None) -> None:
        self.error = error
        self.requests: list[ExportRequest] = []

    def export(self, request: ExportRequest) -> ExportResult:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        animations = tuple(
            AnimationExportResult(
                animation=clip.clip_id,
                frame_count=len(request.directions),
                metadata_path=request.destination / clip.clip_id / "animation.json",
                frame_paths=(request.destination / clip.clip_id / "SE" / "000.png",),
            )
            for clip in request.animations
        )
        return ExportResult(destination=request.destination, animations=animations)


class NeverCancelled:
    def is_cancelled(self) -> bool:
        return False


def _repository(
    *,
    project: ProjectManifest | None = None,
    animations: Mapping[str, AnimationClip] | None = None,
    rig: RigDefinition | None = None,
) -> FakeProjectRepository:
    default_animations = {
        "animations/idle.animated-clip.json": _clip("idle"),
        "animations/walk.animated-clip.json": _clip("walk"),
    }
    return FakeProjectRepository(
        project
        or _project(
            "animations/idle.animated-clip.json",
            "animations/walk.animated-clip.json",
        ),
        default_animations if animations is None else animations,
        rig=rig,
    )


def _request(**changes: object) -> ExportProjectRequest:
    request = ExportProjectRequest(
        project_root=Path("/project"),
        destination=Path("/build/test_actor"),
        animation_ids=("walk", "idle"),
        directions=(Direction.NE, Direction.SE),
        fps=12,
        cancellation=NeverCancelled(),
    )
    return replace(request, **changes)


def _use_case(
    repository: FakeProjectRepository,
    *,
    layers: FakeLayerRepository | None = None,
    validator: StubValidator | None = None,
    exporter: FakeExporter | None = None,
) -> tuple[ExportProject, FakeLayerRepository, StubValidator, FakeExporter]:
    layer_repository = layers or FakeLayerRepository()
    project_validator = validator or StubValidator()
    project_exporter = exporter or FakeExporter()
    return (
        ExportProject(repository, layer_repository, project_validator, project_exporter),
        layer_repository,
        project_validator,
        project_exporter,
    )


def test_success_loads_complete_snapshot_once_and_preserves_selected_order() -> None:
    repository = _repository()
    warning_z = Diagnostic(code="ZZZ002", severity=Severity.WARNING, message="Later warning")
    warning_a = Diagnostic(code="AAA001", severity=Severity.WARNING, message="Earlier warning")
    use_case, layers, validator, exporter = _use_case(
        repository,
        validator=StubValidator((warning_z, warning_a)),
    )

    result = use_case.execute(_request())

    assert result.value is not None, result.diagnostics
    assert result.value.destination == Path("/build/test_actor")
    assert [item.code for item in result.diagnostics] == ["AAA001", "ZZZ002"]
    assert repository.project_roots == [Path("/project")]
    assert repository.rig_loads == [(Path("/project"), "rig/main.animated-rig.json")]
    assert repository.animation_loads == [
        (Path("/project"), "animations/idle.animated-clip.json"),
        (Path("/project"), "animations/walk.animated-clip.json"),
    ]
    assert layers.roots == [Path("/project")]
    assert len(validator.inputs) == 1
    assert [document.clip.clip_id for document in validator.inputs[0].animations] == [
        "idle",
        "walk",
    ]
    assert validator.inputs[0].assets == ()
    assert len(exporter.requests) == 1
    low_level = exporter.requests[0]
    assert [clip.clip_id for clip in low_level.animations] == ["walk", "idle"]
    assert low_level.directions == (Direction.NE, Direction.SE)
    assert low_level.project.root == Path("/project")
    assert low_level.destination == Path("/build/test_actor")
    assert low_level.cancellation is not None


def test_project_exporter_protocol_is_runtime_checkable() -> None:
    assert isinstance(FakeExporter(), ProjectExporter)


@pytest.mark.parametrize(
    ("changes", "expected_code", "expected_location"),
    [
        ({"project_root": cast(Path, "/project")}, EXPORT_PROFILE_CODE, "project_root"),
        ({"destination": cast(Path, "/build")}, EXPORT_DESTINATION_CODE, "destination"),
        ({"animation_ids": ()}, EXPORT_PROFILE_CODE, "animation_ids"),
        ({"animation_ids": ("idle", "idle")}, EXPORT_PROFILE_CODE, "animation_ids"),
        ({"animation_ids": ("Not Valid",)}, EXPORT_PROFILE_CODE, "animation_ids"),
        ({"directions": ()}, EXPORT_PROFILE_CODE, "directions"),
        ({"directions": (Direction.SE, Direction.SE)}, EXPORT_PROFILE_CODE, "directions"),
        ({"directions": cast(tuple[Direction, ...], ("SE",))}, EXPORT_PROFILE_CODE, "directions"),
        ({"fps": 0}, EXPORT_PROFILE_CODE, "fps"),
        ({"fps": 241}, EXPORT_PROFILE_CODE, "fps"),
        ({"fps": True}, EXPORT_PROFILE_CODE, "fps"),
        ({"allow_clipping": cast(bool, 1)}, EXPORT_PROFILE_CODE, "allow_clipping"),
        ({"cancellation": object()}, EXPORT_PROFILE_CODE, "cancellation"),
    ],
)
def test_invalid_request_is_rejected_before_repository_access(
    changes: dict[str, object],
    expected_code: str,
    expected_location: str,
) -> None:
    repository = _repository()
    use_case, layers, validator, exporter = _use_case(repository)

    result = use_case.execute(_request(**changes))

    assert result.value is None
    assert [(item.code, item.location) for item in result.diagnostics] == [
        (expected_code, expected_location)
    ]
    assert repository.project_roots == []
    assert layers.roots == []
    assert validator.inputs == []
    assert exporter.requests == []


@pytest.mark.parametrize(
    "error",
    [
        ProjectValidationError("Malformed project.", path="project.animated-fabric.json"),
        ProjectVersionError("Unsupported project.", path="project.animated-fabric.json"),
    ],
)
def test_project_boundary_failures_map_to_profile_diagnostic(
    error: ProjectValidationError | ProjectVersionError,
) -> None:
    repository = _repository()
    repository.project_error = error
    use_case, layers, validator, exporter = _use_case(repository)

    result = use_case.execute(_request())

    assert [(item.code, item.path) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "project.animated-fabric.json")
    ]
    assert layers.roots == []
    assert validator.inputs == []
    assert exporter.requests == []


def test_layer_catalog_failure_maps_to_profile_diagnostic() -> None:
    repository = _repository()
    layers = FakeLayerRepository(
        error=ProjectValidationError("Missing layer catalog.", path="layers.manifest.json")
    )
    use_case, _, validator, exporter = _use_case(repository, layers=layers)

    result = use_case.execute(_request())

    assert [(item.code, item.path) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "layers.manifest.json")
    ]
    assert len(repository.animation_loads) == 2
    assert validator.inputs == []
    assert exporter.requests == []


def test_duplicate_registered_paths_are_rejected_without_loading_clips() -> None:
    path = "animations/idle.animated-clip.json"
    repository = _repository(project=_project(path, path), animations={path: _clip("idle")})
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(_request(animation_ids=("idle",)))

    assert [(item.code, item.location) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "animation_paths")
    ]
    assert repository.animation_loads == []
    assert validator.inputs == []
    assert exporter.requests == []


def test_duplicate_clip_ids_are_rejected_after_each_registered_file_is_loaded_once() -> None:
    first = "animations/idle.animated-clip.json"
    second = "animations/idle_copy.animated-clip.json"
    repository = _repository(
        project=_project(first, second),
        animations={first: _clip("idle"), second: _clip("idle")},
    )
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(_request(animation_ids=("idle",)))

    assert result.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert result.diagnostics[0].location == "animation_paths"
    assert [path for _, path in repository.animation_loads] == [first, second]
    assert validator.inputs == []
    assert exporter.requests == []


@pytest.mark.parametrize("mismatch", ["rig", "clip"])
def test_template_mismatch_blocks_export(mismatch: str) -> None:
    path = "animations/idle.animated-clip.json"
    rig = _rig("quadruped_v1") if mismatch == "rig" else _rig()
    clip = _clip("idle", template_id="quadruped_v1" if mismatch == "clip" else "humanoid_v1")
    repository = _repository(project=_project(path), animations={path: clip}, rig=rig)
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(_request(animation_ids=("idle",)))

    assert result.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert result.diagnostics[0].location == "template_id"
    assert validator.inputs == []
    assert exporter.requests == []


def test_missing_selection_and_mirrored_direction_are_profile_failures() -> None:
    repository = _repository()
    use_case, _, validator, exporter = _use_case(repository)

    missing = use_case.execute(_request(animation_ids=("run",)))
    mirrored = use_case.execute(_request(directions=(Direction.SW,)))

    assert missing.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert missing.diagnostics[0].location == "animation_ids"
    assert mirrored.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert mirrored.diagnostics[0].location == "directions.SW.mode"
    assert validator.inputs == []
    assert exporter.requests == []


def test_blocking_validation_preserves_sorted_warnings_and_prevents_export() -> None:
    repository = _repository()
    warning = Diagnostic(code="ZZZ001", severity=Severity.WARNING, message="Warning")
    error = Diagnostic(code="AAA001", severity=Severity.ERROR, message="Blocking")
    use_case, _, validator, exporter = _use_case(
        repository,
        validator=StubValidator((warning, error)),
    )

    result = use_case.execute(_request())

    assert result.value is None
    assert [item.code for item in result.diagnostics] == ["AAA001", "ZZZ001"]
    assert len(validator.inputs) == 1
    assert exporter.requests == []


def test_total_frame_limit_is_checked_before_exporter_invocation() -> None:
    first = "animations/long_a.animated-clip.json"
    second = "animations/long_b.animated-clip.json"
    repository = _repository(
        project=_project(first, second),
        animations={
            first: _clip("long_a", duration_ms=10_000),
            second: _clip("long_b", duration_ms=10_000),
        },
    )
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(
        _request(
            animation_ids=("long_a", "long_b"),
            directions=(Direction.SE,),
            fps=240,
        )
    )

    assert result.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert "4096" in result.diagnostics[0].message
    assert len(validator.inputs) == 1
    assert exporter.requests == []


def test_single_animation_schedule_limit_maps_to_profile_diagnostic() -> None:
    path = "animations/very_long.animated-clip.json"
    repository = _repository(
        project=_project(path),
        animations={path: _clip("very_long", duration_ms=20_000)},
    )
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(
        _request(animation_ids=("very_long",), directions=(Direction.SE,), fps=240)
    )

    assert result.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert "4096" in result.diagnostics[0].message
    assert len(validator.inputs) == 1
    assert exporter.requests == []


def test_raw_rgba_limit_is_checked_before_exporter_invocation() -> None:
    path = "animations/large.animated-clip.json"
    repository = _repository(
        project=_project(path, canvas_width=2048, canvas_height=2048),
        animations={path: _clip("large", duration_ms=33_000)},
    )
    use_case, _, validator, exporter = _use_case(repository)

    result = use_case.execute(_request(animation_ids=("large",), directions=(Direction.SE,), fps=1))

    assert result.diagnostics[0].code == EXPORT_PROFILE_CODE
    assert "536870912" in result.diagnostics[0].message
    assert len(validator.inputs) == 1
    assert exporter.requests == []


@pytest.mark.parametrize(
    ("kind", "expected_code"),
    [
        (ExportFailureKind.CLIPPING, EXPORT_CLIPPING_CODE),
        (ExportFailureKind.INVALID_PROFILE, EXPORT_PROFILE_CODE),
        (ExportFailureKind.DESTINATION, EXPORT_DESTINATION_CODE),
        (ExportFailureKind.CANCELLED, EXPORT_FAILURE_CODE),
        (ExportFailureKind.RENDER, EXPORT_FAILURE_CODE),
        (ExportFailureKind.VERIFICATION, EXPORT_FAILURE_CODE),
        (ExportFailureKind.PUBLICATION, EXPORT_FAILURE_CODE),
    ],
)
def test_export_errors_map_to_stable_diagnostics_and_preserve_context(
    kind: ExportFailureKind,
    expected_code: str,
) -> None:
    repository = _repository()
    error = ExportError(
        "Controlled export failure.",
        kind=kind,
        path="output/walk" if kind is not ExportFailureKind.DESTINATION else None,
        location="frames[2]",
    )
    exporter = FakeExporter(error)
    warning = Diagnostic(code="AFV304", severity=Severity.WARNING, message="Warning")
    use_case, _, _, _ = _use_case(
        repository,
        validator=StubValidator((warning,)),
        exporter=exporter,
    )

    result = use_case.execute(_request())

    failures = [item for item in result.diagnostics if item.severity is Severity.ERROR]
    assert len(failures) == 1
    assert failures[0].code == expected_code
    assert failures[0].message == "Controlled export failure."
    assert failures[0].path == (
        "/build/test_actor" if kind is ExportFailureKind.DESTINATION else "output/walk"
    )
    assert failures[0].location == "frames[2]"
    assert failures[0].suggestion
    assert len(exporter.requests) == 1
