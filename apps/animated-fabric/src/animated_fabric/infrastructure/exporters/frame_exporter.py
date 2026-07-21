"""Transactional deterministic frame-sequence export infrastructure."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from animated_fabric.application.exporting import (
    MAX_EXPORT_FPS,
    MAX_EXPORT_FRAMES,
    MAX_EXPORT_RAW_BYTES,
    AnimationExportResult,
    ExportRequest,
    ExportResult,
    FrameSample,
    build_frame_schedule,
)
from animated_fabric.application.rendering import RenderedFrame, Renderer, RenderRequest
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind, RenderError
from animated_fabric.domain.export import FrameSequenceFrame, FrameSequenceMetadata
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.project import Direction, DirectionMode
from animated_fabric.infrastructure.imaging import PngFrameWriter


class FrameSequenceExporter:
    """Render and publish one actor-scoped frame-sequence tree as a transaction."""

    exporter_id = "frame_sequence_v1"

    def __init__(
        self,
        renderer: Renderer,
        writer: PngFrameWriter | None = None,
    ) -> None:
        self._renderer = renderer
        self._writer = writer or PngFrameWriter()

    def export(self, request: ExportRequest) -> ExportResult:
        """Render, verify, and replace the complete requested destination."""
        if not isinstance(request, ExportRequest):
            raise TypeError("Frame-sequence export requires an ExportRequest.")

        schedules = self._validate_request(request)
        self._check_cancelled(request, "before export IO")
        destination = self._validate_destination(request)
        staging = self._create_staging(destination)

        try:
            results, metadata = self._render_frames(request, schedules, staging)
            expected_pngs = {
                frame_path.as_posix() for result in results for frame_path in result.frame_paths
            }
            self._verify_pngs(
                staging,
                expected_pngs,
                width=request.project.manifest.canvas.width,
                height=request.project.manifest.canvas.height,
            )
            self._write_and_verify_metadata(request, staging, metadata, expected_pngs)
            self._check_cancelled(request, "before export publication")
            self._promote(staging, destination)
        except ExportError:
            self._discard_staging(staging)
            raise
        except OSError as error:
            self._discard_staging(staging)
            raise ExportError(
                "The frame-sequence export could not be published safely.",
                kind=ExportFailureKind.PUBLICATION,
                path=str(destination),
            ) from error

        return ExportResult(destination=destination, animations=results)

    @staticmethod
    def _validate_request(
        request: ExportRequest,
    ) -> tuple[tuple[FrameSample, ...], ...]:
        try:
            schedules = tuple(
                build_frame_schedule(animation, request.fps) for animation in request.animations
            )
        except (TypeError, ValueError) as error:
            raise ExportError(
                str(error),
                kind=ExportFailureKind.INVALID_PROFILE,
            ) from error

        if not 0 < request.fps <= MAX_EXPORT_FPS:
            raise ExportError(
                f"Export FPS must be between 1 and {MAX_EXPORT_FPS}.",
                kind=ExportFailureKind.INVALID_PROFILE,
            )
        for direction in request.directions:
            definition = request.project.manifest.directions.get(direction)
            if definition is None or definition.mode is not DirectionMode.AUTHORED:
                raise ExportError(
                    f"Frame export supports authored directions only; "
                    f"'{direction.value}' is not authored.",
                    kind=ExportFailureKind.INVALID_PROFILE,
                    location=direction.value,
                )

        total_frames = sum(len(schedule) for schedule in schedules) * len(request.directions)
        if total_frames > MAX_EXPORT_FRAMES:
            raise ExportError(
                f"An export request may not exceed {MAX_EXPORT_FRAMES} total frames.",
                kind=ExportFailureKind.INVALID_PROFILE,
            )
        canvas = request.project.manifest.canvas
        raw_bytes = total_frames * canvas.width * canvas.height * 4
        if raw_bytes > MAX_EXPORT_RAW_BYTES:
            raise ExportError(
                f"An export request may not exceed {MAX_EXPORT_RAW_BYTES} raw RGBA bytes.",
                kind=ExportFailureKind.INVALID_PROFILE,
            )
        return schedules

    @classmethod
    def _validate_destination(cls, request: ExportRequest) -> Path:
        try:
            destination = request.destination.absolute()
            cls._reject_symlink_components(destination)
            if destination.exists() and not destination.is_dir():
                raise ExportError(
                    "The export destination is a file, not a directory.",
                    kind=ExportFailureKind.DESTINATION,
                    path=str(destination),
                )
            resolved_destination = destination.resolve(strict=False)
            project_root = request.project.root.resolve(strict=False)
            exports_root = (project_root / "exports").resolve(strict=False)
        except ExportError:
            raise
        except (OSError, RuntimeError) as error:
            raise ExportError(
                "The export destination cannot be resolved safely.",
                kind=ExportFailureKind.DESTINATION,
                path=str(request.destination),
            ) from error

        if project_root == resolved_destination or project_root.is_relative_to(
            resolved_destination
        ):
            raise ExportError(
                "The export destination cannot contain the project root.",
                kind=ExportFailureKind.DESTINATION,
                path=str(destination),
            )
        if resolved_destination.is_relative_to(project_root) and (
            resolved_destination == exports_root
            or not resolved_destination.is_relative_to(exports_root)
        ):
            raise ExportError(
                "Project-local exports must use a named directory below 'exports'.",
                kind=ExportFailureKind.DESTINATION,
                path=str(destination),
            )
        return resolved_destination

    @staticmethod
    def _reject_symlink_components(destination: Path) -> None:
        current = Path(destination.anchor)
        for part in destination.parts[1:]:
            current /= part
            try:
                is_link = current.is_symlink()
            except OSError as error:
                raise ExportError(
                    "The export destination cannot be inspected safely.",
                    kind=ExportFailureKind.DESTINATION,
                    path=str(destination),
                ) from error
            if is_link:
                raise ExportError(
                    "The export destination and its existing ancestors must not be symlinks.",
                    kind=ExportFailureKind.DESTINATION,
                    path=str(destination),
                )

    @staticmethod
    def _create_staging(destination: Path) -> Path:
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            name = tempfile.mkdtemp(
                prefix=f".{destination.name}.stage-",
                dir=destination.parent,
            )
        except OSError as error:
            raise ExportError(
                "The export destination is not writable.",
                kind=ExportFailureKind.DESTINATION,
                path=str(destination),
            ) from error
        return Path(name)

    def _render_frames(
        self,
        request: ExportRequest,
        schedules: tuple[tuple[FrameSample, ...], ...],
        staging: Path,
    ) -> tuple[tuple[AnimationExportResult, ...], tuple[FrameSequenceMetadata, ...]]:
        results: list[AnimationExportResult] = []
        metadata_documents: list[FrameSequenceMetadata] = []
        canvas = request.project.manifest.canvas

        for animation, schedule in zip(request.animations, schedules, strict=True):
            exported_frames: list[Path] = []
            metadata_frames: list[FrameSequenceFrame] = []
            for direction in request.directions:
                for sample in schedule:
                    relative_path = (
                        Path(animation.clip_id) / direction.value / f"{sample.index:03d}.png"
                    )
                    self._check_cancelled(request, relative_path.as_posix())
                    frame = self._render_frame(request, animation, direction, sample, relative_path)
                    if (
                        frame.canvas_size.width != canvas.width
                        or frame.canvas_size.height != canvas.height
                    ):
                        raise ExportError(
                            "The renderer returned a frame with the wrong canvas dimensions.",
                            kind=ExportFailureKind.VERIFICATION,
                            path=relative_path.as_posix(),
                        )
                    if frame.clipping.is_clipped and not request.allow_clipping:
                        raise ExportError(
                            "The rendered frame touches a canvas edge while clipping is disabled.",
                            kind=ExportFailureKind.CLIPPING,
                            path=relative_path.as_posix(),
                        )
                    self._check_cancelled(request, relative_path.as_posix())
                    self._write_frame(staging / relative_path, frame, request, relative_path)
                    exported_frames.append(relative_path)
                    metadata_frames.append(
                        FrameSequenceFrame(
                            direction=direction,
                            index=sample.index,
                            image=f"{direction.value}/{sample.index:03d}.png",
                            duration_ms=sample.duration_ms,
                            events=sample.events,
                        )
                    )

            metadata_path = Path(animation.clip_id) / "animation.json"
            try:
                metadata = FrameSequenceMetadata(
                    format="animated-fabric.frame-sequence.v1",
                    schema_version="0.1.0",
                    project=request.project.manifest.slug,
                    animation=animation.clip_id,
                    frame_size=IntSize(width=canvas.width, height=canvas.height),
                    origin=Vec2(x=canvas.ground_anchor.x, y=canvas.ground_anchor.y),
                    fps=request.fps,
                    duration_ms=animation.duration_ms,
                    directions=request.directions,
                    frames_per_direction=len(schedule),
                    frames=tuple(metadata_frames),
                )
            except ValidationError as error:
                raise ExportError(
                    "The generated frame-sequence metadata is invalid.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=metadata_path.as_posix(),
                ) from error
            results.append(
                AnimationExportResult(
                    animation=animation.clip_id,
                    frame_count=len(schedule),
                    metadata_path=metadata_path,
                    frame_paths=tuple(exported_frames),
                )
            )
            metadata_documents.append(metadata)

        return tuple(results), tuple(metadata_documents)

    def _render_frame(
        self,
        request: ExportRequest,
        animation: AnimationClip,
        direction: Direction,
        sample: FrameSample,
        relative_path: Path,
    ) -> RenderedFrame:
        try:
            return self._renderer.render(
                RenderRequest(
                    project=request.project,
                    rig=request.rig,
                    clip=animation,
                    direction=direction,
                    time_ms=sample.time_ms,
                    include_events=True,
                )
            )
        except RenderError as error:
            raise ExportError(
                str(error),
                kind=ExportFailureKind.RENDER,
                path=relative_path.as_posix(),
            ) from error

    def _write_frame(
        self,
        destination: Path,
        frame: RenderedFrame,
        request: ExportRequest,
        relative_path: Path,
    ) -> None:
        try:
            self._writer.write_project_frame(destination, frame, request.project)
        except RenderError as error:
            raise ExportError(
                str(error),
                kind=ExportFailureKind.PUBLICATION,
                path=relative_path.as_posix(),
            ) from error

    @staticmethod
    def _verify_pngs(
        staging: Path,
        expected_pngs: set[str],
        *,
        width: int,
        height: int,
    ) -> None:
        actual_files = FrameSequenceExporter._relative_files(staging)
        if actual_files != expected_pngs:
            raise ExportError(
                "The staged PNG file set does not match the export plan.",
                kind=ExportFailureKind.VERIFICATION,
            )

        for relative_path in sorted(expected_pngs):
            candidate = staging.joinpath(*relative_path.split("/"))
            try:
                with Image.open(candidate) as image:
                    image.load()
                    if image.format != "PNG" or image.mode != "RGBA":
                        raise ExportError(
                            "An exported frame is not a decoded RGBA PNG.",
                            kind=ExportFailureKind.VERIFICATION,
                            path=relative_path,
                        )
                    if image.size != (width, height):
                        raise ExportError(
                            "An exported frame has the wrong canvas dimensions.",
                            kind=ExportFailureKind.VERIFICATION,
                            path=relative_path,
                        )
            except ExportError:
                raise
            except (
                Image.DecompressionBombError,
                OSError,
                SyntaxError,
                UnidentifiedImageError,
                ValueError,
            ) as error:
                raise ExportError(
                    "An exported PNG frame could not be decoded.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=relative_path,
                ) from error

    @staticmethod
    def _relative_files(root: Path) -> set[str]:
        files: set[str] = set()
        try:
            candidates = tuple(root.rglob("*"))
        except OSError as error:
            raise ExportError(
                "The staged export cannot be inspected.",
                kind=ExportFailureKind.VERIFICATION,
            ) from error
        for candidate in candidates:
            try:
                if candidate.is_symlink():
                    raise ExportError(
                        "The staged export must not contain symbolic links.",
                        kind=ExportFailureKind.VERIFICATION,
                    )
                if candidate.is_file():
                    files.add(candidate.relative_to(root).as_posix())
            except OSError as error:
                raise ExportError(
                    "The staged export cannot be inspected.",
                    kind=ExportFailureKind.VERIFICATION,
                ) from error
        return files

    @staticmethod
    def _write_and_verify_metadata(
        request: ExportRequest,
        staging: Path,
        metadata_documents: tuple[FrameSequenceMetadata, ...],
        expected_pngs: set[str],
    ) -> None:
        expected_metadata: set[str] = set()
        for metadata in metadata_documents:
            relative_path = f"{metadata.animation}/animation.json"
            FrameSequenceExporter._check_cancelled(request, relative_path)
            destination = staging.joinpath(*relative_path.split("/"))
            expected_metadata.add(relative_path)
            try:
                payload = json.dumps(
                    metadata.model_dump(mode="json"),
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                destination.write_text(payload + "\n", encoding="utf-8", newline="\n")
                parsed = FrameSequenceMetadata.model_validate_json(destination.read_bytes())
            except (OSError, ValidationError) as error:
                raise ExportError(
                    "The frame-sequence metadata could not be written and verified.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=relative_path,
                ) from error
            if parsed != metadata:
                raise ExportError(
                    "The verified frame-sequence metadata does not match the export plan.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=relative_path,
                )

        if FrameSequenceExporter._relative_files(staging) != expected_pngs | expected_metadata:
            raise ExportError(
                "The staged export file set changed during metadata publication.",
                kind=ExportFailureKind.VERIFICATION,
            )

    @staticmethod
    def _check_cancelled(request: ExportRequest, location: str) -> None:
        if request.cancellation is not None and request.cancellation.is_cancelled():
            raise ExportError(
                "The frame-sequence export was cancelled.",
                kind=ExportFailureKind.CANCELLED,
                location=location,
            )

    @staticmethod
    def _promote(staging: Path, destination: Path) -> None:
        backup: Path | None = None
        empty_backup: Path | None = None
        try:
            if destination.exists():
                backup_name = tempfile.mkdtemp(
                    prefix=f".{destination.name}.backup-",
                    dir=destination.parent,
                )
                empty_backup = Path(backup_name)
                empty_backup.rmdir()
                os.replace(destination, empty_backup)
                backup = empty_backup
                empty_backup = None
            os.replace(staging, destination)
            if backup is not None:
                shutil.rmtree(backup)
        except OSError as error:
            if empty_backup is not None:
                FrameSequenceExporter._discard_staging(empty_backup)
            rollback_error = FrameSequenceExporter._rollback_publication(
                staging,
                destination,
                backup,
            )
            if rollback_error is not None:
                raise ExportError(
                    "Export publication failed and the previous output could not be restored.",
                    kind=ExportFailureKind.PUBLICATION,
                    path=str(destination),
                ) from rollback_error
            raise ExportError(
                "Export publication failed; the previous output was restored.",
                kind=ExportFailureKind.PUBLICATION,
                path=str(destination),
            ) from error

    @staticmethod
    def _rollback_publication(
        staging: Path,
        destination: Path,
        backup: Path | None,
    ) -> OSError | None:
        try:
            if backup is None or not backup.exists():
                return None
            if destination.exists():
                os.replace(destination, staging)
            os.replace(backup, destination)
        except OSError as error:
            return error
        return None

    @staticmethod
    def _discard_staging(staging: Path) -> None:
        try:
            if staging.exists():
                shutil.rmtree(staging)
        except OSError:
            # Crash recovery and abandoned-transaction cleanup remain separate work.
            return


__all__ = ["FrameSequenceExporter"]
