"""Application contracts and use cases for importing prepared PNG layers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from animated_fabric.application.ports import ProjectRepository
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    AssetImportError,
    ProjectValidationError,
    ProjectVersionError,
)
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction, DirectionMode

IMPORT_FAILURE_CODE = "AFI001"
IMPORT_CANVAS_MISMATCH_CODE = "AFI007"
IMPORT_DIRECTION_CODE = "AFI008"
IMPORT_MAPPING_PROPOSAL_CODE = "AFI010"


@dataclass(frozen=True, slots=True)
class ImportLimits:
    """Configurable safety limits for one folder importer instance."""

    max_layer_dimension: int = 2048
    max_file_bytes: int = 50 * 1024 * 1024
    max_layers: int = 500

    def __post_init__(self) -> None:
        for name, value in (
            ("max_layer_dimension", self.max_layer_dimension),
            ("max_file_bytes", self.max_file_bytes),
            ("max_layers", self.max_layers),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")


@dataclass(frozen=True, slots=True)
class InspectedLayer:
    """Decoded, side-effect-free facts and one semantic proposal for a source PNG."""

    source_name: str
    proposed_semantic_part: str | None
    source_canvas_size: IntSize
    alpha_origin: IntPoint | None
    alpha_size: IntSize | None
    source_sha256: str
    fully_transparent: bool
    touches_edge: bool


@dataclass(frozen=True, slots=True)
class ImportInspection:
    """Stable inspection candidates accompanied by actionable diagnostics."""

    layers: tuple[InspectedLayer, ...] = ()
    diagnostics: tuple[Diagnostic, ...] = ()

    @property
    def has_errors(self) -> bool:
        """Return whether inspection found a blocking input problem."""
        return any(item.severity is Severity.ERROR for item in self.diagnostics)


@dataclass(frozen=True, slots=True)
class LayerAssignment:
    """A user-confirmed mapping from one direct source filename to a canonical part."""

    source_name: str
    semantic_part: str
    optional: bool = False


@dataclass(frozen=True, slots=True)
class LayerImportRequest:
    """All reviewed inputs needed to publish one direction's layer set."""

    project_root: Path
    source: Path
    direction: Direction
    assignments: tuple[LayerAssignment, ...]
    trim: bool = True


@dataclass(frozen=True, slots=True)
class ImportResult:
    """The complete canonical layer catalog after a successful import."""

    imported_assets: tuple[AssetLayer, ...]
    catalog_assets: tuple[AssetLayer, ...]
    manifest_path: str
    diagnostics: tuple[Diagnostic, ...] = ()


class LayerImporter(Protocol):
    """Port implemented by prepared-layer source adapters."""

    def inspect(self, source: Path) -> ImportInspection:
        """Inspect a source without modifying it or a project."""
        ...

    def import_layers(self, request: LayerImportRequest) -> ImportResult:
        """Publish one confirmed layer set into an approved project."""
        ...


def import_failure(error: AssetImportError) -> Diagnostic:
    """Translate one expected importer failure into a stable diagnostic."""
    return Diagnostic(
        code=IMPORT_FAILURE_CODE,
        severity=Severity.ERROR,
        message=str(error) or "Layer import could not continue.",
        suggestion="Check the source folder, confirmed mappings, and project paths.",
    )


class InspectLayerFolder:
    """Run side-effect-free inspection through the shared importer port."""

    def __init__(self, importer: LayerImporter) -> None:
        self._importer = importer

    def execute(self, source: Path) -> OperationResult[ImportInspection]:
        """Return inspection facts or one typed boundary diagnostic."""
        try:
            inspection = self._importer.inspect(source)
        except AssetImportError as error:
            return OperationResult[ImportInspection](diagnostics=(import_failure(error),))
        return OperationResult[ImportInspection](
            value=inspection,
            diagnostics=inspection.diagnostics,
        )


class ImportLayerSet:
    """Publish a reviewed layer set through the same importer used by the CLI and GUI."""

    def __init__(self, importer: LayerImporter, projects: ProjectRepository) -> None:
        self._importer = importer
        self._projects = projects

    def execute(self, request: LayerImportRequest) -> OperationResult[ImportResult]:
        """Return imported assets or a typed expected-failure diagnostic."""
        try:
            project = self._projects.load(request.project_root)
            inspection = self._importer.inspect(request.source)
        except (ProjectValidationError, ProjectVersionError) as error:
            return OperationResult[ImportResult](
                diagnostics=(import_failure(AssetImportError(str(error))),)
            )
        except AssetImportError as error:
            return OperationResult[ImportResult](diagnostics=(import_failure(error),))

        if inspection.has_errors:
            return OperationResult[ImportResult](diagnostics=inspection.diagnostics)

        direction = project.directions.get(request.direction)
        if direction is None or direction.mode is not DirectionMode.AUTHORED:
            return OperationResult[ImportResult](
                diagnostics=(
                    Diagnostic(
                        code=IMPORT_DIRECTION_CODE,
                        severity=Severity.ERROR,
                        message=(
                            f"Direction '{request.direction.value}' is not authored by "
                            "this project."
                        ),
                        location=f"directions.{request.direction.value}",
                        suggestion=(
                            "Import art only for a project direction configured as authored."
                        ),
                    ),
                )
            )

        for layer in inspection.layers:
            size = layer.source_canvas_size
            if size.width != project.canvas.width or size.height != project.canvas.height:
                return OperationResult[ImportResult](
                    diagnostics=(
                        Diagnostic(
                            code=IMPORT_CANVAS_MISMATCH_CODE,
                            severity=Severity.ERROR,
                            message=(
                                f"Layer '{layer.source_name}' uses canvas {size.width} x "
                                f"{size.height}; project canvas is {project.canvas.width} x "
                                f"{project.canvas.height}."
                            ),
                            path=layer.source_name,
                            location="source_canvas_size",
                            suggestion="Prepare every authored layer on the project canvas.",
                        ),
                    )
                )

        try:
            result = self._importer.import_layers(request)
        except AssetImportError as error:
            return OperationResult[ImportResult](diagnostics=(import_failure(error),))
        return OperationResult[ImportResult](
            value=result,
            diagnostics=result.diagnostics,
        )


__all__ = [
    "IMPORT_CANVAS_MISMATCH_CODE",
    "IMPORT_DIRECTION_CODE",
    "IMPORT_FAILURE_CODE",
    "IMPORT_MAPPING_PROPOSAL_CODE",
    "ImportInspection",
    "ImportLayerSet",
    "ImportLimits",
    "ImportResult",
    "InspectLayerFolder",
    "InspectedLayer",
    "LayerAssignment",
    "LayerImportRequest",
    "LayerImporter",
    "import_failure",
]
