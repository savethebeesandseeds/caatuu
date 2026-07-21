"""Transactional deterministic frame-sequence export infrastructure."""

from __future__ import annotations

import json
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
from animated_fabric.infrastructure.exporters._transaction import (
    create_export_staging,
    discard_export_staging,
    promote_export_staging,
    relative_export_files,
    validate_export_destination,
)
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

    def export(self, request: ExportRequest) -> ExportResult[AnimationExportResult]:
        """Render, verify, and replace the complete requested destination."""
        if not isinstance(request, ExportRequest):
            raise TypeError("Frame-sequence export requires an ExportRequest.")

        schedules = self._validate_request(request)
        self._check_cancelled(request, "before export IO")
        destination = validate_export_destination(request.destination, request.project.root)
        staging = create_export_staging(destination)
        retained_backup: Path | None = None

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
            retained_backup = promote_export_staging(staging, destination)
        except ExportError:
            raise
        except OSError as error:
            raise ExportError(
                "The frame-sequence export could not be published safely.",
                kind=ExportFailureKind.PUBLICATION,
                path=str(destination),
            ) from error
        finally:
            discard_export_staging(staging)

        return ExportResult(
            destination=destination,
            animations=results,
            retained_backup=retained_backup,
        )

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
        actual_files = relative_export_files(staging)
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

        if relative_export_files(staging) != expected_pngs | expected_metadata:
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


__all__ = ["FrameSequenceExporter"]
