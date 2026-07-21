"""AF-051 tests for built-in profile resolution and grid-export delegation."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from animated_fabric.application.export_profiles import (
    DEFAULT_GRID_PROFILE_ID,
    ExportGridProject,
    GridExportProjectRequest,
    resolve_builtin_export_profile,
)
from animated_fabric.application.export_service import (
    EXPORT_PROFILE_CODE,
    ExportProject,
    ExportProjectRequest,
)
from animated_fabric.application.exporting import (
    CancellationToken,
    ExportRequest,
    ExportResult,
    GridAnimationExportResult,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.diagnostics import OperationResult
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)


def _clip(clip_id: str) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name=clip_id.title(),
        template_id="humanoid_v1",
        duration_ms=1000,
        loop=True,
        fps_hint=12,
    )


class _RecordingExportProject(ExportProject):
    """Record delegated requests without crossing repository or renderer boundaries."""

    def __init__(self) -> None:
        self.requests: list[ExportProjectRequest] = []

    def execute(self, request: ExportProjectRequest) -> OperationResult[ExportResult]:
        self.requests.append(request)
        return OperationResult(
            value=ExportResult(
                destination=request.destination,
                animations=(
                    GridAnimationExportResult(
                        animation=request.animation_ids[0],
                        frame_count=1,
                        image_path=Path(f"{request.animation_ids[0]}.png"),
                        metadata_path=Path(f"{request.animation_ids[0]}.spritesheet.json"),
                    ),
                ),
            )
        )


class _ProjectRepository:
    def __init__(self, manifest: ProjectManifest) -> None:
        self.manifest = manifest
        self.clips = {
            "animations/idle.animated-clip.json": _clip("idle"),
            "animations/walk.animated-clip.json": _clip("walk"),
        }

    def load(self, root: Path) -> ProjectManifest:
        del root
        return self.manifest

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        del root, path
        return build_stick_humanoid_rig()

    def load_animation(self, root: Path, path: str) -> AnimationClip:
        del root
        return self.clips[path]


class _LayerRepository:
    def __init__(self) -> None:
        self.calls = 0

    def load_layer_manifest(self, root: Path) -> LayerManifest:
        del root
        self.calls += 1
        return LayerManifest(
            format="animated-fabric.layer-manifest.v1",
            schema_version="0.1.0",
            layers=(),
        )


class _NeverExporter:
    exporter_id = "never"

    def export(self, request: ExportRequest) -> ExportResult:
        del request
        raise AssertionError("Profile preflight must reject before exporter invocation.")


class _Cancellation:
    def is_cancelled(self) -> bool:
        return False


def _manifest(*, registered: bool) -> ProjectManifest:
    return build_stick_humanoid_manifest().model_copy(
        update={
            "animation_paths": (
                "animations/idle.animated-clip.json",
                "animations/walk.animated-clip.json",
            ),
            "export_profiles": (DEFAULT_GRID_PROFILE_ID,) if registered else (),
        }
    )


def _real_use_case(*, registered: bool) -> tuple[ExportGridProject, _LayerRepository]:
    layers = _LayerRepository()
    export_project = ExportProject(
        _ProjectRepository(_manifest(registered=registered)),
        layers,
        ProjectValidator(),
        _NeverExporter(),
    )
    return ExportGridProject(export_project), layers


def _request(**changes: object) -> GridExportProjectRequest:
    request = GridExportProjectRequest(
        project_root=Path("/project"),
        destination=Path("/build/actor"),
        profile_id=DEFAULT_GRID_PROFILE_ID,
    )
    return replace(request, **changes)


def test_default_grid_profile_matches_the_normative_order_and_options() -> None:
    profile = resolve_builtin_export_profile(DEFAULT_GRID_PROFILE_ID)

    assert profile.profile_id == "default_grid"
    assert profile.format == "animated-fabric.grid-spritesheet.v1"
    assert profile.animations == ("idle", "walk")
    assert profile.directions == (
        Direction.SE,
        Direction.SW,
        Direction.NE,
        Direction.NW,
    )
    assert profile.fps == 12
    assert profile.trim_frames is False
    assert profile.include_json is True
    assert profile.allow_clipping is False
    assert profile.include_generated_at is False


@pytest.mark.parametrize("profile_id", ["missing_profile", "Default Grid", cast(str, 7)])
def test_unknown_or_invalid_profile_is_a_stable_profile_diagnostic(
    profile_id: str,
) -> None:
    delegate = _RecordingExportProject()

    result = ExportGridProject(delegate).execute(_request(profile_id=profile_id))

    assert result.value is None
    assert [(item.code, item.location) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "profile_id")
    ]
    assert delegate.requests == []


def test_explicit_overrides_preserve_caller_order_and_profile_registration() -> None:
    delegate = _RecordingExportProject()
    cancellation: CancellationToken = _Cancellation()

    result = ExportGridProject(delegate).execute(
        _request(
            animation_ids=("walk", "idle"),
            directions=(Direction.NE, Direction.SE),
            fps=24,
            allow_clipping=True,
            cancellation=cancellation,
        )
    )

    assert result.value is not None
    assert len(delegate.requests) == 1
    delegated = delegate.requests[0]
    assert delegated.animation_ids == ("walk", "idle")
    assert delegated.directions == (Direction.NE, Direction.SE)
    assert delegated.fps == 24
    assert delegated.allow_clipping is True
    assert delegated.cancellation is cancellation
    assert delegated.profile_id == DEFAULT_GRID_PROFILE_ID


def test_project_must_register_the_selected_builtin_profile() -> None:
    use_case, layers = _real_use_case(registered=False)

    result = use_case.execute(
        _request(
            animation_ids=("idle",),
            directions=(Direction.SE,),
        )
    )

    assert result.value is None
    assert [(item.code, item.path, item.location) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "project.animated-fabric.json", "export_profiles")
    ]
    assert layers.calls == 0


def test_default_profile_stops_at_the_intentional_af052_mirroring_boundary() -> None:
    use_case, layers = _real_use_case(registered=True)

    result = use_case.execute(_request())

    assert result.value is None
    assert [(item.code, item.location) for item in result.diagnostics] == [
        (EXPORT_PROFILE_CODE, "directions.SW.mode")
    ]
    assert "AF-052" in (result.diagnostics[0].suggestion or "")
    assert layers.calls == 1
