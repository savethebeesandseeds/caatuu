"""Application orchestration for validated, deterministic project exports."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from animated_fabric.application.exporting import (
    MAX_EXPORT_FPS,
    MAX_EXPORT_FRAMES,
    MAX_EXPORT_RAW_BYTES,
    CancellationToken,
    ExportRequest,
    ExportResult,
    build_frame_schedule,
)
from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    PROJECT_MANIFEST_FILENAME,
    LayerManifestRepository,
    ProjectExporter,
    ProjectRepository,
)
from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain._base import SemanticId
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    ExportError,
    ExportFailureKind,
    ProjectValidationError,
    ProjectVersionError,
)
from animated_fabric.domain.project import Direction, DirectionMode, ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import AnimationDocument, ProjectValidator, ValidationInput
from animated_fabric.domain.validation.models import diagnostic_sort_key

EXPORT_CLIPPING_CODE = "AFV501"
EXPORT_PROFILE_CODE = "AFV502"
EXPORT_DESTINATION_CODE = "AFV503"
EXPORT_FAILURE_CODE = "AFE001"

_SEMANTIC_ID_ADAPTER = TypeAdapter(SemanticId)


@dataclass(frozen=True, slots=True)
class ExportProjectRequest:
    """Select the complete project state and export scope for one publication."""

    project_root: Path
    destination: Path
    animation_ids: tuple[str, ...]
    directions: tuple[Direction, ...]
    fps: int
    allow_clipping: bool = False
    cancellation: CancellationToken | None = None


@dataclass(frozen=True, slots=True)
class _LoadedProject:
    manifest: ProjectManifest
    rig: RigDefinition
    documents: tuple[AnimationDocument, ...]


class ExportProject:
    """Load, validate, preflight, and export one coherent actor snapshot."""

    def __init__(
        self,
        projects: ProjectRepository,
        layers: LayerManifestRepository,
        validator: ProjectValidator,
        exporter: ProjectExporter,
    ) -> None:
        self._projects = projects
        self._layers = layers
        self._validator = validator
        self._exporter = exporter

    def execute(self, request: ExportProjectRequest) -> OperationResult[ExportResult]:
        """Export only a fully loaded and structurally valid project snapshot."""
        request_failure = _validate_request(request)
        if request_failure is not None:
            return OperationResult[ExportResult](diagnostics=(request_failure,))

        loaded = self._load_project(request.project_root)
        if isinstance(loaded, Diagnostic):
            return OperationResult[ExportResult](diagnostics=(loaded,))

        try:
            catalog = self._layers.load_layer_manifest(request.project_root)
        except (ProjectValidationError, ProjectVersionError) as error:
            return OperationResult[ExportResult](
                diagnostics=(
                    _profile_diagnostic(
                        str(error) or "The project layer catalog could not be loaded.",
                        path=getattr(error, "path", None) or LAYER_MANIFEST_FILENAME,
                        suggestion="Restore a valid layer catalog before exporting.",
                    ),
                )
            )

        compatibility_failure = _compatibility_failure(loaded)
        if compatibility_failure is not None:
            return OperationResult[ExportResult](diagnostics=(compatibility_failure,))

        selection = _select_animations(loaded.documents, request.animation_ids)
        if isinstance(selection, Diagnostic):
            return OperationResult[ExportResult](diagnostics=(selection,))

        direction_failure = _validate_directions(loaded.manifest, request.directions)
        if direction_failure is not None:
            return OperationResult[ExportResult](diagnostics=(direction_failure,))

        diagnostics = tuple(
            sorted(
                self._validator.validate(
                    ValidationInput(
                        manifest=loaded.manifest,
                        rig=loaded.rig,
                        animations=loaded.documents,
                        assets=catalog.layers,
                    )
                ),
                key=diagnostic_sort_key,
            )
        )
        if any(item.severity is Severity.ERROR for item in diagnostics):
            return OperationResult[ExportResult](diagnostics=diagnostics)

        limit_failure = _limit_failure(
            selection,
            request.directions,
            request.fps,
            canvas_width=loaded.manifest.canvas.width,
            canvas_height=loaded.manifest.canvas.height,
        )
        if limit_failure is not None:
            return OperationResult[ExportResult](
                diagnostics=_sorted_diagnostics((*diagnostics, limit_failure))
            )

        render_project = RenderProject(
            root=request.project_root,
            manifest=loaded.manifest,
            assets={asset.asset_id: asset for asset in catalog.layers},
        )
        try:
            export_request = ExportRequest(
                project=render_project,
                rig=loaded.rig,
                animations=selection,
                directions=request.directions,
                fps=request.fps,
                destination=request.destination,
                allow_clipping=request.allow_clipping,
                cancellation=request.cancellation,
            )
        except (TypeError, ValueError) as error:
            failure = _profile_diagnostic(
                str(error) or "The export settings are invalid.",
                suggestion="Correct the selected animations, directions, and frame settings.",
            )
            return OperationResult[ExportResult](
                diagnostics=_sorted_diagnostics((*diagnostics, failure))
            )

        try:
            result = self._exporter.export(export_request)
        except ExportError as error:
            failure = _export_error_diagnostic(error, request.destination)
            return OperationResult[ExportResult](
                diagnostics=_sorted_diagnostics((*diagnostics, failure))
            )
        return OperationResult[ExportResult](value=result, diagnostics=diagnostics)

    def _load_project(self, root: Path) -> _LoadedProject | Diagnostic:
        try:
            manifest = self._projects.load(root)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _profile_diagnostic(
                str(error) or "The project manifest could not be loaded.",
                path=getattr(error, "path", None) or PROJECT_MANIFEST_FILENAME,
                suggestion="Open a valid Animated Fabric project before exporting.",
            )

        try:
            rig = self._projects.load_rig(root, manifest.rig_path)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _profile_diagnostic(
                str(error) or "The project rig could not be loaded.",
                path=getattr(error, "path", None) or manifest.rig_path,
                suggestion="Restore a valid rig document before exporting.",
            )

        if len(manifest.animation_paths) != len(set(manifest.animation_paths)):
            return _profile_diagnostic(
                "The project manifest registers the same animation path more than once.",
                path=PROJECT_MANIFEST_FILENAME,
                location="animation_paths",
                suggestion="Keep each registered animation path exactly once.",
            )

        documents: list[AnimationDocument] = []
        for path in manifest.animation_paths:
            try:
                clip = self._projects.load_animation(root, path)
            except (ProjectValidationError, ProjectVersionError) as error:
                return _profile_diagnostic(
                    str(error) or "A registered animation clip could not be loaded.",
                    path=getattr(error, "path", None) or path,
                    suggestion="Restore or remove the invalid registered animation document.",
                )
            documents.append(AnimationDocument(path=path, clip=clip))

        clip_ids = tuple(document.clip.clip_id for document in documents)
        if len(clip_ids) != len(set(clip_ids)):
            return _profile_diagnostic(
                "The project registers more than one animation with the same clip ID.",
                path=PROJECT_MANIFEST_FILENAME,
                location="animation_paths",
                suggestion="Keep exactly one registered animation for each clip ID.",
            )

        return _LoadedProject(manifest=manifest, rig=rig, documents=tuple(documents))


def _validate_request(request: ExportProjectRequest) -> Diagnostic | None:
    if not isinstance(request.project_root, Path):
        return _profile_diagnostic(
            "Export request field 'project_root' must be a pathlib.Path.",
            location="project_root",
            suggestion="Choose an existing Animated Fabric project folder.",
        )
    if not isinstance(request.destination, Path):
        return _destination_diagnostic(
            "Export request field 'destination' must be a pathlib.Path.",
            location="destination",
            suggestion="Choose a writable export destination folder.",
        )
    if not isinstance(request.animation_ids, tuple) or not request.animation_ids:
        return _profile_diagnostic(
            "At least one animation ID must be selected for export.",
            location="animation_ids",
            suggestion="Select one or more registered animation IDs.",
        )
    for animation_id in request.animation_ids:
        try:
            _SEMANTIC_ID_ADAPTER.validate_python(animation_id)
        except (ValidationError, TypeError, ValueError, RecursionError):
            return _profile_diagnostic(
                "Every selected animation ID must be a lowercase snake_case identifier.",
                location="animation_ids",
                suggestion="Select registered semantic animation IDs without duplicates.",
            )
    if len(request.animation_ids) != len(set(request.animation_ids)):
        return _profile_diagnostic(
            "Selected animation IDs must be unique.",
            location="animation_ids",
            suggestion="Keep each selected animation ID exactly once.",
        )
    if (
        not isinstance(request.directions, tuple)
        or not request.directions
        or any(not isinstance(direction, Direction) for direction in request.directions)
    ):
        return _profile_diagnostic(
            "At least one typed direction must be selected for export.",
            location="directions",
            suggestion="Select one or more supported Direction values.",
        )
    if len(request.directions) != len(set(request.directions)):
        return _profile_diagnostic(
            "Selected export directions must be unique.",
            location="directions",
            suggestion="Keep each selected direction exactly once.",
        )
    if type(request.fps) is not int or not 1 <= request.fps <= MAX_EXPORT_FPS:
        return _profile_diagnostic(
            f"Export FPS must be an integer from 1 through {MAX_EXPORT_FPS}.",
            location="fps",
            suggestion="Choose a bounded positive export frame rate.",
        )
    if type(request.allow_clipping) is not bool:
        return _profile_diagnostic(
            "Export request field 'allow_clipping' must be boolean.",
            location="allow_clipping",
            suggestion="Use true only after deliberately reviewing clipped output.",
        )
    if request.cancellation is not None and not callable(
        getattr(request.cancellation, "is_cancelled", None)
    ):
        return _profile_diagnostic(
            "Export cancellation must implement is_cancelled().",
            location="cancellation",
            suggestion="Provide a compatible cancellation token or omit it.",
        )
    return None


def _compatibility_failure(loaded: _LoadedProject) -> Diagnostic | None:
    manifest = loaded.manifest
    if loaded.rig.template_id != manifest.template_id:
        return _profile_diagnostic(
            "The project manifest and rig use different anatomical templates.",
            path=manifest.rig_path,
            location="template_id",
            suggestion="Restore a rig matching the project's configured template.",
        )
    for document in loaded.documents:
        if document.clip.template_id != manifest.template_id:
            return _profile_diagnostic(
                f"Animation '{document.clip.clip_id}' does not match the project template.",
                path=document.path,
                location="template_id",
                suggestion="Regenerate the animation for this project's anatomical template.",
            )
    return None


def _select_animations(
    documents: tuple[AnimationDocument, ...],
    animation_ids: tuple[str, ...],
) -> tuple[AnimationClip, ...] | Diagnostic:
    by_id = {document.clip.clip_id: document.clip for document in documents}
    missing = tuple(animation_id for animation_id in animation_ids if animation_id not in by_id)
    if missing:
        missing_text = ", ".join(f"'{animation_id}'" for animation_id in missing)
        return _profile_diagnostic(
            f"Selected animation IDs are not registered by the project: {missing_text}.",
            location="animation_ids",
            suggestion="Select only animation IDs registered in the project manifest.",
        )
    return tuple(by_id[animation_id] for animation_id in animation_ids)


def _validate_directions(
    manifest: ProjectManifest,
    directions: tuple[Direction, ...],
) -> Diagnostic | None:
    for direction in directions:
        definition = manifest.directions.get(direction)
        if definition is None:
            return _profile_diagnostic(
                f"Direction '{direction.value}' is not defined by this project.",
                path=PROJECT_MANIFEST_FILENAME,
                location=f"directions.{direction.value}",
                suggestion="Select a direction defined by the project manifest.",
            )
        if definition.mode is not DirectionMode.AUTHORED:
            return _profile_diagnostic(
                f"Direction '{direction.value}' is mirrored and cannot be exported by AF-050.",
                path=PROJECT_MANIFEST_FILENAME,
                location=f"directions.{direction.value}.mode",
                suggestion="Select an authored direction; mirrored export is introduced in AF-052.",
            )
    return None


def _limit_failure(
    animations: tuple[AnimationClip, ...],
    directions: tuple[Direction, ...],
    fps: int,
    *,
    canvas_width: int,
    canvas_height: int,
) -> Diagnostic | None:
    total_frames = 0
    for animation in animations:
        try:
            frame_count = len(build_frame_schedule(animation, fps))
        except ValueError as error:
            return _profile_diagnostic(
                str(error) or "An animation exceeds the supported frame schedule.",
                location="animation_ids",
                suggestion="Reduce the animation duration or export FPS.",
            )
        total_frames += frame_count * len(directions)
    if total_frames > MAX_EXPORT_FRAMES:
        return _profile_diagnostic(
            f"The export would produce {total_frames} frames; the limit is {MAX_EXPORT_FRAMES}.",
            location="animation_ids",
            suggestion="Reduce the selected animations, directions, durations, or FPS.",
        )
    raw_bytes = total_frames * canvas_width * canvas_height * 4
    if raw_bytes > MAX_EXPORT_RAW_BYTES:
        return _profile_diagnostic(
            f"The export's uncompressed RGBA frame estimate exceeds {MAX_EXPORT_RAW_BYTES} bytes.",
            location="animation_ids",
            suggestion="Reduce the canvas, selected animations, directions, durations, or FPS.",
        )
    return None


def _export_error_diagnostic(error: ExportError, destination: Path) -> Diagnostic:
    code = EXPORT_FAILURE_CODE
    suggestion = "Review the export failure, preserve the previous output, and retry."
    if error.kind is ExportFailureKind.CLIPPING:
        code = EXPORT_CLIPPING_CODE
        suggestion = "Increase the canvas or explicitly allow reviewed clipping before retrying."
    elif error.kind is ExportFailureKind.INVALID_PROFILE:
        code = EXPORT_PROFILE_CODE
        suggestion = "Correct the export settings and retry with a supported profile."
    elif error.kind is ExportFailureKind.DESTINATION:
        code = EXPORT_DESTINATION_CODE
        suggestion = "Choose a safe writable destination outside immutable project sources."
    elif error.kind is ExportFailureKind.CANCELLED:
        suggestion = "Start the export again when the complete operation can finish."
    elif error.kind is ExportFailureKind.RENDER:
        suggestion = "Correct the reported project rendering problem and retry."
    elif error.kind is ExportFailureKind.VERIFICATION:
        suggestion = "Check available storage and retry the complete verified export."
    elif error.kind is ExportFailureKind.PUBLICATION:
        suggestion = "Check destination permissions and retry; the previous output was preserved."

    path = error.path
    if path is None and error.kind is ExportFailureKind.DESTINATION:
        path = str(destination)
    return Diagnostic(
        code=code,
        severity=Severity.ERROR,
        message=str(error) or "The export could not complete safely.",
        path=path,
        location=error.location,
        suggestion=suggestion,
    )


def _profile_diagnostic(
    message: str,
    *,
    path: str | None = None,
    location: str | None = None,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=EXPORT_PROFILE_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _destination_diagnostic(
    message: str,
    *,
    path: str | None = None,
    location: str | None = None,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=EXPORT_DESTINATION_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _sorted_diagnostics(diagnostics: tuple[Diagnostic, ...]) -> tuple[Diagnostic, ...]:
    return tuple(sorted(diagnostics, key=diagnostic_sort_key))


__all__ = [
    "EXPORT_CLIPPING_CODE",
    "EXPORT_DESTINATION_CODE",
    "EXPORT_FAILURE_CODE",
    "EXPORT_PROFILE_CODE",
    "ExportProject",
    "ExportProjectRequest",
]
