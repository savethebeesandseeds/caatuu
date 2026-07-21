"""Built-in export profiles and the public grid-export application boundary."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from pydantic import TypeAdapter, ValidationError

from animated_fabric.application.export_service import (
    EXPORT_PROFILE_CODE,
    ExportProject,
    ExportProjectRequest,
)
from animated_fabric.application.exporting import (
    CancellationToken,
    ExportResult,
    GridAnimationExportResult,
)
from animated_fabric.domain._base import SemanticId
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.export import ExportProfile
from animated_fabric.domain.project import Direction

DEFAULT_GRID_PROFILE_ID = "default_grid"

_SEMANTIC_ID_ADAPTER = TypeAdapter(SemanticId)
_BUILTIN_EXPORT_PROFILES: Mapping[str, ExportProfile] = MappingProxyType(
    {
        DEFAULT_GRID_PROFILE_ID: ExportProfile(
            profile_id=DEFAULT_GRID_PROFILE_ID,
            format="animated-fabric.grid-spritesheet.v1",
            animations=("idle", "walk"),
            directions=(Direction.SE, Direction.SW, Direction.NE, Direction.NW),
            fps=12,
            trim_frames=False,
            include_json=True,
            allow_clipping=False,
            include_generated_at=False,
        )
    }
)


def resolve_builtin_export_profile(profile_id: str) -> ExportProfile:
    """Return one fixed package-owned profile without dynamic discovery or project IO."""
    try:
        normalized = _SEMANTIC_ID_ADAPTER.validate_python(profile_id)
    except (ValidationError, TypeError, ValueError, RecursionError) as error:
        raise ValueError(
            "Export profile IDs must be lowercase ASCII snake_case identifiers."
        ) from error
    try:
        return _BUILTIN_EXPORT_PROFILES[normalized]
    except KeyError as error:
        raise ValueError(f"Export profile '{normalized}' is not supported.") from error


@dataclass(frozen=True, slots=True)
class GridExportProjectRequest:
    """Resolve one built-in grid profile plus explicit caller overrides."""

    project_root: Path
    destination: Path
    profile_id: str
    animation_ids: tuple[str, ...] | None = None
    directions: tuple[Direction, ...] | None = None
    fps: int | None = None
    allow_clipping: bool = False
    cancellation: CancellationToken | None = None


class ExportGridProject:
    """Apply a package-owned grid profile and delegate coherent project export."""

    def __init__(self, exporter: ExportProject[GridAnimationExportResult]) -> None:
        if not isinstance(exporter, ExportProject):
            raise TypeError("Grid export requires the shared ExportProject use case.")
        self._exporter = exporter

    def execute(
        self,
        request: GridExportProjectRequest,
    ) -> OperationResult[ExportResult[GridAnimationExportResult]]:
        """Resolve the selected grid profile and export with explicit stable overrides."""
        if not isinstance(request, GridExportProjectRequest):
            return OperationResult[ExportResult[GridAnimationExportResult]](
                diagnostics=(
                    _profile_failure(
                        "Grid export requires a typed GridExportProjectRequest.",
                        location="request",
                    ),
                )
            )
        try:
            profile = resolve_builtin_export_profile(request.profile_id)
        except ValueError as error:
            return OperationResult[ExportResult[GridAnimationExportResult]](
                diagnostics=(
                    _profile_failure(
                        str(error) or "The export profile is not supported.",
                        location="profile_id",
                    ),
                )
            )

        if profile.trim_frames or not profile.include_json or profile.include_generated_at:
            return OperationResult[ExportResult[GridAnimationExportResult]](
                diagnostics=(
                    _profile_failure(
                        "The selected profile uses grid options that AF-051 does not support.",
                        location="profile_id",
                    ),
                )
            )

        return self._exporter.execute(
            ExportProjectRequest(
                project_root=request.project_root,
                destination=request.destination,
                animation_ids=(
                    profile.animations if request.animation_ids is None else request.animation_ids
                ),
                directions=(
                    profile.directions if request.directions is None else request.directions
                ),
                fps=profile.fps if request.fps is None else request.fps,
                allow_clipping=request.allow_clipping,
                cancellation=request.cancellation,
                profile_id=profile.profile_id,
            )
        )


def _profile_failure(message: str, *, location: str) -> Diagnostic:
    return Diagnostic(
        code=EXPORT_PROFILE_CODE,
        severity=Severity.ERROR,
        message=message,
        location=location,
        suggestion=(
            "Use a project-registered built-in profile and override only supported grid options."
        ),
    )


__all__ = [
    "DEFAULT_GRID_PROFILE_ID",
    "ExportGridProject",
    "GridExportProjectRequest",
    "resolve_builtin_export_profile",
]
